/**
 * Tenant boundary helpers — Tenant Boundary Refactor (2026-07-06).
 *
 * `pursuits` is the company-scoped home for tenant opinion about a canonical
 * opportunity (triage notes, stage, project linkage). During the dual-write
 * window the legacy columns on `opportunity_candidates` remain authoritative
 * for reads wherever a pursuit row does not exist yet.
 *
 * Every function here is fail-soft by design: if the tenant tables have not
 * been created in production yet (migrations 20260706230000/20260706231000
 * pending), or the user has no company membership, calls no-op and the legacy
 * write path continues to work. This makes the frontend deploy safe in either
 * order relative to migration application.
 *
 * Tables are accessed through an untyped client (`supabase as any`) because
 * the generated types file is Lovable-managed and does not know the new
 * tables yet — the same precedent as useOpportunityDossier.ts.
 */

import { supabase } from "@/integrations/supabase/client";

export interface PursuitLite {
  id: string;
  opportunity_candidate_id: string;
  stage: string;
  triage_notes: string | null;
  project_id: string | null;
}

let cachedCompanyId: string | null | undefined;

/** Company of the signed-in user (single-membership era). Cached per page load. */
export async function getActiveCompanyId(): Promise<string | null> {
  if (cachedCompanyId !== undefined) return cachedCompanyId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { cachedCompanyId = null; return null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in Lovable-generated types yet
    const sb = supabase as any;
    const { data, error } = await sb
      .from("company_members")
      .select("company_id")
      .eq("profile_id", session.user.id)
      .limit(1)
      .maybeSingle();
    cachedCompanyId = error ? null : (data?.company_id ?? null);
  } catch {
    cachedCompanyId = null;
  }
  if (cachedCompanyId === null) {
    console.warn("[tenant] no active company (tenant migrations pending or no membership); pursuit writes will no-op");
  }
  return cachedCompanyId;
}

/**
 * All pursuits visible to the user (RLS scopes to their company).
 * Returns an empty map when the table does not exist yet.
 */
export async function fetchCompanyPursuits(): Promise<Map<string, PursuitLite>> {
  const map = new Map<string, PursuitLite>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in Lovable-generated types yet
    const sb = supabase as any;
    const { data, error } = await sb
      .from("pursuits")
      .select("id, opportunity_candidate_id, stage, triage_notes, project_id");
    if (error || !data) return map;
    for (const row of data as PursuitLite[]) {
      map.set(row.opportunity_candidate_id, row);
    }
  } catch {
    /* fail-soft: legacy columns remain the read source */
  }
  return map;
}

/**
 * Upsert the company's pursuit row for a candidate. Only the provided fields
 * are written; the insert path relies on column defaults (stage 'reviewing').
 * Never throws — a failure leaves the legacy write path as the safety net.
 */
export async function upsertPursuit(
  opportunityCandidateId: string,
  patch: Partial<Pick<PursuitLite, "stage" | "triage_notes" | "project_id">>,
): Promise<boolean> {
  try {
    const companyId = await getActiveCompanyId();
    if (!companyId) return false;
    const { data: { session } } = await supabase.auth.getSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in Lovable-generated types yet
    const sb = supabase as any;
    const { error } = await sb
      .from("pursuits")
      .upsert(
        {
          company_id: companyId,
          opportunity_candidate_id: opportunityCandidateId,
          // Included on the update path too; harmless while companies are
          // single-member. Revisit if/when multi-member lands.
          created_by: session?.user?.id ?? null,
          ...patch,
        },
        { onConflict: "company_id,opportunity_candidate_id" },
      );
    if (error) {
      console.warn("[tenant] pursuit upsert failed (legacy columns still written):", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[tenant] pursuit upsert failed (legacy columns still written):", e);
    return false;
  }
}
