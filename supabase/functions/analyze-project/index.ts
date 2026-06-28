import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalyzeRequest {
  candidate_id?: string;
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
      return jsonResponse({ success: false, error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as AnalyzeRequest;
    const candidateId = body.candidate_id;

    if (!candidateId) {
      return jsonResponse({ success: false, error: "candidate_id is required" }, 400);
    }

    const { data: candidate, error: candidateError } = await adminClient
      .from("opportunity_candidates")
      .select(`
        id,
        source_id,
        source_url,
        portal_type,
        raw_title,
        agency,
        bid_due_at,
        analysis_status,
        analysis_task_id,
        document_acquisition_status,
        opportunity_sources(name)
      `)
      .eq("id", candidateId)
      .maybeSingle();

    if (candidateError) {
      console.error("analyze-project candidate lookup failed:", candidateError);
      return jsonResponse({ success: false, error: "Failed to load opportunity" }, 500);
    }

    if (!candidate) {
      return jsonResponse({ success: false, error: "Opportunity not found" }, 404);
    }

    if (candidate.bid_due_at) {
      const due = new Date(candidate.bid_due_at);
      if (!isNaN(due.getTime()) && due.getTime() < Date.now()) {
        return jsonResponse({ success: false, error: "Cannot analyze a closed bid" }, 400);
      }
    }

    const activeStatuses = ["pending", "running", "retrying"];
    const { data: activeTasks, error: activeTaskError } = await adminClient
      .from("agent_tasks")
      .select("id, status, created_at")
      .in("task_type", ["project_analysis", "document_processing", "project_intelligence"])
      .in("status", activeStatuses)
      .contains("payload", { candidate_id: candidateId })
      .order("created_at", { ascending: false })
      .limit(1);

    if (activeTaskError) {
      console.error("analyze-project active task lookup failed:", activeTaskError);
      return jsonResponse({ success: false, error: "Failed to check active analysis tasks" }, 500);
    }

    const existingTask = activeTasks?.[0] ?? null;
    if (existingTask) {
      const documentStatus = existingTask.status === "running" ? "acquiring" : "queued";
      await adminClient
        .from("opportunity_candidates")
        .update({
          analysis_status: "queued",
          analysis_task_id: existingTask.id,
          document_acquisition_status: documentStatus,
          analysis_error: null,
          opportunity_lifecycle_status: "opportunity_intelligence_queued",
          opportunity_intelligence_status: documentStatus === "acquiring" ? "acquiring_documents" : "queued",
          opportunity_intelligence_task_id: existingTask.id,
          opportunity_intelligence_error: null,
        })
        .eq("id", candidateId);

      return jsonResponse({
        success: true,
        queued: false,
        duplicate: true,
        task_id: existingTask.id,
        task_status: existingTask.status,
        analysis_status: "queued",
        document_acquisition_status: documentStatus,
        intelligence_status: "not_generated",
        message: "Analysis is already queued for this opportunity.",
      });
    }

    if (["queued", "acquiring", "acquired"].includes(candidate.document_acquisition_status ?? "")) {
      return jsonResponse({
        success: true,
        queued: false,
        duplicate: true,
        task_id: candidate.analysis_task_id,
        task_status: null,
        analysis_status: candidate.analysis_status,
        document_acquisition_status: candidate.document_acquisition_status,
        intelligence_status: "not_generated",
        message: candidate.document_acquisition_status === "acquired"
          ? "Documents are already acquired and ready for processing."
          : "Document acquisition is already queued for this opportunity.",
      });
    }

    const requestedAt = new Date().toISOString();
    const sourceName = Array.isArray(candidate.opportunity_sources)
      ? candidate.opportunity_sources[0]?.name
      : candidate.opportunity_sources?.name;

    const { data: task, error: taskError } = await adminClient
      .from("agent_tasks")
      .insert({
        task_type: "project_analysis",
        status: "pending",
        priority: 0,
        trigger_reason: "manual_retry",
        refresh_window: new Date().toISOString().slice(0, 13),
        payload: {
          candidate_id: candidate.id,
          source_id: candidate.source_id,
          source_name: sourceName ?? candidate.agency ?? "Unknown source",
          source_url: candidate.source_url,
          portal_type: candidate.portal_type,
          agency: candidate.agency,
          raw_title: candidate.raw_title,
          bid_due_at: candidate.bid_due_at,
          requested_by: user.id,
          requested_at: requestedAt,
          trigger_reason: "manual_retry",
          preparation_reason: "manual recovery action",
          intelligence_tier: "opportunity",
        phase: "f5_opportunity_preparation",
        next_phase: "f2_document_acquisition",
        intelligence_status: "not_generated",
      },
      })
      .select("id, status, created_at")
      .single();

    if (taskError || !task) {
      console.error("analyze-project task insert failed:", taskError);
      return jsonResponse({ success: false, error: "Failed to queue analysis" }, 500);
    }

    const { error: updateError } = await adminClient
      .from("opportunity_candidates")
      .update({
        analysis_status: "queued",
        analysis_task_id: task.id,
        analysis_requested_at: requestedAt,
        analysis_started_at: null,
        analysis_completed_at: null,
        analysis_error: null,
        analysis_requested_by: user.id,
        document_acquisition_status: "queued",
        document_acquisition_started_at: null,
        document_acquisition_completed_at: null,
        document_acquisition_error: null,
        opportunity_lifecycle_status: "opportunity_intelligence_queued",
        opportunity_intelligence_status: "queued",
        opportunity_intelligence_task_id: task.id,
        opportunity_intelligence_error: null,
      })
      .eq("id", candidateId);

    if (updateError) {
      console.error("analyze-project candidate update failed:", updateError);
      return jsonResponse({ success: false, error: "Analysis task was queued, but candidate state was not updated" }, 500);
    }

    return jsonResponse({
      success: true,
      queued: true,
      duplicate: false,
      task_id: task.id,
      task_status: task.status,
      analysis_status: "queued",
      document_acquisition_status: "queued",
      intelligence_status: "not_generated",
      message: "Opportunity preparation queued.",
    });
  } catch (error) {
    console.error("analyze-project error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
