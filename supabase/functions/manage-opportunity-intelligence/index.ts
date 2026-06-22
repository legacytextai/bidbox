import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "delete_project" | "delete_analysis" | "reanalyze";

interface ManageRequest {
  action?: Action;
  project_id?: string;
  candidate_id?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function removeStorageObjects(adminClient: any, bucket: string, paths: string[]) {
  const uniquePaths = uniqueValues(paths);
  if (uniquePaths.length === 0) return 0;
  const { error } = await adminClient.storage.from(bucket).remove(uniquePaths);
  if (error) {
    console.error(`Failed to remove ${bucket} storage objects:`, error.message);
    return 0;
  }
  return uniquePaths.length;
}

async function requireUser(req: Request, supabaseUrl: string, anonKey: string) {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) throw new Response(JSON.stringify({ success: false, error: "Missing authorization header" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();

  if (error || !user) throw new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  return user;
}

async function loadProjectForUser(adminClient: any, projectId: string, userId: string) {
  const { data: project, error } = await adminClient
    .from("projects")
    .select("id, gc_id, origin, source_opportunity_candidate_id, opportunity_intelligence_report_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Project lookup failed: ${error.message}`);
  if (!project) throw new Error("Project not found");
  if (project.gc_id !== userId) throw new Error("Project does not belong to the current user");
  if (project.origin !== "opportunity_intelligence") {
    throw new Error("Only Opportunity Intelligence projects can be deleted here");
  }

  return project;
}

async function deleteOpportunityProject(adminClient: any, projectId: string, userId: string) {
  const project = await loadProjectForUser(adminClient, projectId, userId);

  const { data: files } = await adminClient
    .from("project_files")
    .select("file_url")
    .eq("project_id", projectId);

  const { data: bids } = await adminClient
    .from("bids")
    .select("file_url")
    .eq("project_id", projectId);

  const projectFilesRemoved = await removeStorageObjects(
    adminClient,
    "project-files",
    (files ?? []).map((file: any) => file.file_url),
  );
  const bidFilesRemoved = await removeStorageObjects(
    adminClient,
    "bid-submissions",
    (bids ?? []).map((bid: any) => bid.file_url),
  );

  await adminClient.from("bids").delete().eq("project_id", projectId);
  await adminClient.from("project_files").delete().eq("project_id", projectId);
  await adminClient.from("project_trades").delete().eq("project_id", projectId);
  await adminClient.from("project_bid_readiness").delete().eq("project_id", projectId);

  const { error: projectDeleteError } = await adminClient
    .from("projects")
    .delete()
    .eq("id", projectId);
  if (projectDeleteError) throw new Error(`Project delete failed: ${projectDeleteError.message}`);

  if (project.source_opportunity_candidate_id) {
    const { error: candidateUpdateError } = await adminClient
      .from("opportunity_candidates")
      .update({
        converted_project_id: null,
        status: "pending",
      })
      .eq("id", project.source_opportunity_candidate_id)
      .eq("converted_project_id", projectId);

    if (candidateUpdateError) {
      throw new Error(`Candidate conversion cleanup failed: ${candidateUpdateError.message}`);
    }
  }

  return {
    project_id: projectId,
    candidate_id: project.source_opportunity_candidate_id,
    project_files_removed: projectFilesRemoved,
    bid_files_removed: bidFilesRemoved,
  };
}

async function removeOpportunityDocuments(adminClient: any, candidateId: string) {
  const { data: documents, error } = await adminClient
    .from("opportunity_documents")
    .select("storage_bucket, storage_path")
    .eq("opportunity_candidate_id", candidateId);

  if (error) throw new Error(`Opportunity document lookup failed: ${error.message}`);

  const pathsByBucket = new Map<string, string[]>();
  for (const doc of documents ?? []) {
    if (!doc.storage_path) continue;
    const bucket = doc.storage_bucket || "opportunity-documents";
    pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), doc.storage_path]);
  }

  let removed = 0;
  for (const [bucket, paths] of pathsByBucket.entries()) {
    removed += await removeStorageObjects(adminClient, bucket, paths);
  }

  const { error: deleteError } = await adminClient
    .from("opportunity_documents")
    .delete()
    .eq("opportunity_candidate_id", candidateId);

  if (deleteError) throw new Error(`Opportunity document delete failed: ${deleteError.message}`);
  return removed;
}

async function deleteAnalysis(adminClient: any, candidateId: string, userId: string) {
  const { data: candidate, error } = await adminClient
    .from("opportunity_candidates")
    .select("id, converted_project_id")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) throw new Error(`Candidate lookup failed: ${error.message}`);
  if (!candidate) throw new Error("Opportunity not found");

  let deletedProject: Record<string, unknown> | null = null;
  if (candidate.converted_project_id) {
    deletedProject = await deleteOpportunityProject(adminClient, candidate.converted_project_id, userId);
  }

  const opportunityDocumentsRemoved = await removeOpportunityDocuments(adminClient, candidateId);

  await adminClient
    .from("agent_tasks")
    .update({ status: "failed", error: "Analysis deleted by user" })
    .in("status", ["pending", "running", "retrying"])
    .contains("payload", { candidate_id: candidateId });

  const { error: reportDeleteError } = await adminClient
    .from("opportunity_intelligence_reports")
    .delete()
    .eq("opportunity_candidate_id", candidateId);
  if (reportDeleteError) throw new Error(`Report cleanup failed: ${reportDeleteError.message}`);

  const { error: resetError } = await adminClient
    .from("opportunity_candidates")
    .update({
      analysis_status: "not_requested",
      analysis_task_id: null,
      analysis_requested_at: null,
      analysis_started_at: null,
      analysis_completed_at: null,
      analysis_error: null,
      analysis_requested_by: null,
      document_acquisition_status: "not_requested",
      document_acquisition_started_at: null,
      document_acquisition_completed_at: null,
      document_acquisition_error: null,
      document_processing_status: "not_requested",
      document_processing_started_at: null,
      document_processing_completed_at: null,
      document_processing_error: null,
      converted_project_id: null,
      status: "pending",
    })
    .eq("id", candidateId);
  if (resetError) throw new Error(`Opportunity reset failed: ${resetError.message}`);

  return {
    candidate_id: candidateId,
    deleted_project: deletedProject,
    opportunity_documents_removed: opportunityDocumentsRemoved,
    opportunity_preserved: true,
  };
}

async function reanalyze(adminClient: any, candidateId: string, userId: string) {
  const activeStatuses = ["pending", "running", "retrying"];
  const { data: activeTasks, error: activeTaskError } = await adminClient
    .from("agent_tasks")
    .select("id, status")
    .in("task_type", ["project_analysis", "document_processing", "project_intelligence"])
    .in("status", activeStatuses)
    .contains("payload", { candidate_id: candidateId })
    .limit(1);

  if (activeTaskError) throw new Error(`Active task lookup failed: ${activeTaskError.message}`);
  if ((activeTasks ?? []).length > 0) {
    throw new Error("This opportunity already has active analysis work. Wait for it to finish before re-analyzing.");
  }

  const { data: candidate, error } = await adminClient
    .from("opportunity_candidates")
    .select("id, source_id, source_url, portal_type, raw_title, agency, bid_due_at")
    .eq("id", candidateId)
    .maybeSingle();

  if (error) throw new Error(`Candidate lookup failed: ${error.message}`);
  if (!candidate) throw new Error("Opportunity not found");

  const { count, error: chunkCountError } = await adminClient
    .from("opportunity_document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("opportunity_candidate_id", candidateId);
  if (chunkCountError) throw new Error(`Chunk count failed: ${chunkCountError.message}`);
  if (!count || count < 1) {
    throw new Error("Re-analysis requires processed document chunks. Run Analyze Project first.");
  }

  const requestedAt = new Date().toISOString();
  const { data: task, error: taskError } = await adminClient
    .from("agent_tasks")
    .insert({
      task_type: "project_analysis",
      status: "pending",
      priority: 0,
      payload: {
        candidate_id: candidate.id,
        source_id: candidate.source_id,
        source_name: candidate.agency ?? "Unknown source",
        source_url: candidate.source_url,
        portal_type: candidate.portal_type,
        agency: candidate.agency,
        raw_title: candidate.raw_title,
        bid_due_at: candidate.bid_due_at,
        requested_by: userId,
        requested_at: requestedAt,
        source: "f4_safe_reanalysis",
        phase: "f2_metadata_refresh",
        next_phase: "f4_project_intelligence",
        safe_reanalysis: true,
      },
    })
    .select("id, status")
    .single();

  if (taskError || !task) throw new Error(`Failed to queue re-analysis: ${taskError?.message ?? "unknown error"}`);

  const { error: candidateUpdateError } = await adminClient
    .from("opportunity_candidates")
    .update({
      analysis_task_id: task.id,
      analysis_requested_at: requestedAt,
      analysis_error: null,
      analysis_requested_by: userId,
    })
    .eq("id", candidateId);

  if (candidateUpdateError) throw new Error(`Candidate re-analysis state update failed: ${candidateUpdateError.message}`);

  return {
    candidate_id: candidateId,
    task_id: task.id,
    previous_report_preserved: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const user = await requireUser(req, supabaseUrl, anonKey);
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as ManageRequest;
    if (body.action === "delete_project") {
      if (!body.project_id) return jsonResponse({ success: false, error: "project_id is required" }, 400);
      const result = await deleteOpportunityProject(adminClient, body.project_id, user.id);
      return jsonResponse({ success: true, action: body.action, ...result });
    }

    if (body.action === "delete_analysis") {
      if (!body.candidate_id) return jsonResponse({ success: false, error: "candidate_id is required" }, 400);
      const result = await deleteAnalysis(adminClient, body.candidate_id, user.id);
      return jsonResponse({ success: true, action: body.action, ...result });
    }

    if (body.action === "reanalyze") {
      if (!body.candidate_id) return jsonResponse({ success: false, error: "candidate_id is required" }, 400);
      const result = await reanalyze(adminClient, body.candidate_id, user.id);
      return jsonResponse({ success: true, action: body.action, ...result });
    }

    return jsonResponse({ success: false, error: "Unsupported action" }, 400);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("manage-opportunity-intelligence error:", error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
