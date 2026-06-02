import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OpportunitySource {
  id: string;
  name: string;
  portal_type: string;
  listing_url: string;
  scan_interval_hours: number;
}

export interface CandidateData {
  source_url: string;
  raw_title: string | null;
  bid_due_at: string | null;
}

export interface DriverContext {
  supabase: ReturnType<typeof createClient>;
  firecrawlApiKey: string;
  lovableApiKey: string;
  log: (msg: string) => void;
}

export interface ScanResult {
  candidates: CandidateData[];
  errors: number;
}

export interface OpportunityDriver {
  scan(source: OpportunitySource, context: DriverContext): Promise<ScanResult>;
}
