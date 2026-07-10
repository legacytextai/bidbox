// download-opportunity-document — F2-lite on-demand single-document download.
//
// Uniform document policy (docs/initiatives/uniform-document-policy.md): the
// user clicks Download on one document row; BidBox returns the file whether or
// not the bytes are already in storage. Backend state stays invisible.
//
// Flow:
//   1. Authenticate the user (JWT), then act with the service role.
//   2. If an acquired opportunity_documents row matches the stable source key,
//      return a signed URL immediately.
//   3. Otherwise (OpenGov only for now) enqueue ONE candidate-scoped
//      document_prefetch task — the validated Phase 3 acquisition path, which
//      is idempotent per document and does NOT cascade to document_processing /
//      project_analysis / project_intelligence — and return {status:"pending"}.
//      The frontend polls this same function until the row is acquired.
//   4. If acquisition already ran recently and the requested document still is
//      not present (e.g. unsupported file type), return {status:"unavailable"}.
//
// Guardrails: single candidate per click, explicit user intent only, no
// scan-time auto-prefetch, no downstream processing/intelligence tasks.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors the worker's OPENGOV_ALLOWED_DOCUMENT_EXTENSIONS default — files
// outside this set are never acquired, so report them Unavailable up front
// instead of burning a browser session to find out.
const ACQUIRABLE_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "ppt", "pptx", "zip", "dwg",
]);

// Only re-enqueue acquisition if the last on-demand run is older than this;
// a fresh completed run that still didn't produce the row means the document
// is genuinely unavailable (unsupported/failed), not "not yet tried".
const RECENT_RUN_WINDOW_MS = 10 * 60 * 1000;

interface DownloadRequest {
  candidate_id?: string;
  source_document_key?: string;
  document_title?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return jsonResponse({ status: "error", error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ status: "error", error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as DownloadRequest;
    const candidateId = body.candidate_id;
    const sourceKey = body.source_document_key;
    if (!candidateId || !sourceKey) {
      return jsonResponse({ status: "error", error: "candidate_id and source_document_key are required" }, 400);
    }

    const { data: candidate, error: candidateError } = await adminClient
      .from("opportunity_candidates")
      .select("id, portal_type, source_url, crawl_data")
      .eq("id", candidateId)
      .maybeSingle();
    if (candidateError) {
      return jsonResponse({ status: "error", error: `Candidate lookup failed: ${candidateError.message}` }, 500);
    }
    if (!candidate) {
      return jsonResponse({ status: "error", error: "Candidate not found" }, 404);
    }

    // 1. Already acquired? Serve it now. The stable source key is the
    //    idempotency key the acquisition drivers persist as source_url.
    const { data: existing, error: existingError } = await adminClient
      .from("opportunity_documents")
      .select("id, file_name, storage_bucket, storage_path, acquisition_status")
      .eq("opportunity_candidate_id", candidateId)
      .eq("source_url", sourceKey)
      .maybeSingle();
    if (existingError) {
      return jsonResponse({ status: "error", error: `Document lookup failed: ${existingError.message}` }, 500);
    }

    if (existing?.acquisition_status === "acquired" && existing.storage_path) {
      const bucket = existing.storage_bucket ?? "opportunity-documents";
      const { data: signed, error: signError } = await adminClient.storage
        .from(bucket)
        .createSignedUrl(existing.storage_path, 3600);
      if (signError || !signed?.signedUrl) {
        return jsonResponse({ status: "error", error: "Could not generate a download link" }, 500);
      }
      return jsonResponse({
        status: "ready",
        signed_url: signed.signedUrl,
        file_name: existing.file_name ?? "document",
      });
    }

    // 2. Not acquired — only OpenGov has a validated on-demand path so far.
    if (candidate.portal_type !== "opengov") {
      return jsonResponse({ status: "unsupported", portal_type: candidate.portal_type });
    }

    // 2a. File types the acquisition path never stores are Unavailable now.
    const manifestDocs: Array<Record<string, unknown>> = Array.isArray(candidate.crawl_data?.documents)
      ? candidate.crawl_data.documents
      : [];
    const keyTail = sourceKey.split("/").pop() ?? "";
    const manifestEntry = manifestDocs.find(
      (d) => String(d?.shared_id ?? d?.id ?? "") === keyTail,
    );
    if (manifestEntry) {
      const extField = String(manifestEntry.file_extension ?? "").trim().replace(/^\./, "");
      const extFromName = String(manifestEntry.filename ?? "").match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? "";
      const ext = (extField || extFromName).toLowerCase();
      if (ext && !ACQUIRABLE_EXTENSIONS.has(ext)) {
        return jsonResponse({ status: "unavailable", reason: "unsupported_file_type" });
      }
    }

    // 3. An acquisition for this candidate already in flight? Reuse it.
    const { data: activeTasks } = await adminClient
      .from("agent_tasks")
      .select("id, status, created_at")
      .eq("task_type", "document_prefetch")
      .in("status", ["pending", "running"])
      .contains("payload", { candidate_id: candidateId })
      .order("created_at", { ascending: false })
      .limit(1);
    if (activeTasks && activeTasks.length > 0) {
      return jsonResponse({ status: "pending", task_id: activeTasks[0].id });
    }

    // 4. A recent completed on-demand run that still didn't produce this row
    //    means the document is genuinely unavailable — don't loop forever.
    const recentCutoff = new Date(Date.now() - RECENT_RUN_WINDOW_MS).toISOString();
    const { data: recentDone } = await adminClient
      .from("agent_tasks")
      .select("id, status, completed_at")
      .eq("task_type", "document_prefetch")
      .eq("trigger_reason", "f2_lite_on_demand_download")
      .in("status", ["complete", "failed"])
      .gte("completed_at", recentCutoff)
      .contains("payload", { candidate_id: candidateId })
      .limit(1);
    if (recentDone && recentDone.length > 0) {
      return jsonResponse({ status: "unavailable", reason: "not_produced_by_acquisition" });
    }

    // 5. Enqueue ONE candidate-scoped acquisition (validated Phase 3 path;
    //    doc-only, no F3/F4 cascade). Per-document idempotency means already
    //    acquired files are skipped, not re-downloaded.
    const { data: task, error: taskError } = await adminClient
      .from("agent_tasks")
      .insert({
        task_type: "document_prefetch",
        status: "pending",
        priority: 4,
        trigger_reason: "f2_lite_on_demand_download",
        payload: {
          candidate_id: candidateId,
          portal_type: "opengov",
          opengov_project_id: candidate.crawl_data?.opengov_project_id ?? null,
          source_url: candidate.source_url,
          trigger_reason: "f2_lite_on_demand_download",
          validation_scope: "single_candidate_only",
          requested_document_key: sourceKey,
          requested_by: user.id,
        },
      })
      .select("id")
      .single();
    if (taskError) {
      return jsonResponse({ status: "error", error: `Could not start download: ${taskError.message}` }, 500);
    }

    return jsonResponse({ status: "pending", task_id: task.id });
  } catch (e) {
    return jsonResponse({ status: "error", error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
