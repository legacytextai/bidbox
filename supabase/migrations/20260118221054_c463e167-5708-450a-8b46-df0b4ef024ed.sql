-- Create bid readiness checklist table
CREATE TABLE project_bid_readiness (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  
  -- Bid Bond
  bond_required boolean,
  bond_delivery_method text,  -- 'online' | 'in_person' | 'both'
  bond_online_submitted boolean,
  bond_in_person_delivered boolean,
  
  -- Job Walk
  job_walk_mandatory boolean,
  job_walk_completed boolean,
  job_walk_attended_by text,
  
  -- Addenda
  addenda_issued boolean,
  addenda_reviewed boolean,
  addenda_reviewed_at timestamptz,
  
  -- Bid Proposal
  proposal_prepared boolean,
  proposal_signed boolean,
  proposal_notarized boolean,
  
  -- Bid Sheet
  bid_sheet_complete boolean,
  
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE project_bid_readiness ENABLE ROW LEVEL SECURITY;

-- GCs can view their own project readiness
CREATE POLICY "GCs can view own project readiness"
  ON project_bid_readiness FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_bid_readiness.project_id 
      AND projects.gc_id = auth.uid()
    )
  );

-- GCs can insert readiness for their projects
CREATE POLICY "GCs can insert own project readiness"
  ON project_bid_readiness FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_bid_readiness.project_id 
      AND projects.gc_id = auth.uid()
    )
  );

-- GCs can update readiness for their projects
CREATE POLICY "GCs can update own project readiness"
  ON project_bid_readiness FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects 
      WHERE projects.id = project_bid_readiness.project_id 
      AND projects.gc_id = auth.uid()
    )
  );