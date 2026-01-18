-- Add derived readiness column to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS is_ready_to_bid boolean DEFAULT false;

-- Create function to evaluate bid readiness based on checklist
CREATE OR REPLACE FUNCTION evaluate_bid_readiness()
RETURNS TRIGGER AS $$
DECLARE
  bond_ok boolean;
  job_walk_ok boolean;
  addenda_ok boolean;
  proposal_ok boolean;
  bid_sheet_ok boolean;
  all_ready boolean;
BEGIN
  -- 1. Bid Bond Section
  -- If bond_required = false → satisfied
  -- If bond_required = true, check delivery method
  IF NEW.bond_required IS NULL OR NEW.bond_required = false THEN
    bond_ok := true;
  ELSE
    -- Check based on delivery method
    CASE NEW.bond_delivery_method
      WHEN 'online' THEN
        bond_ok := COALESCE(NEW.bond_online_submitted, false);
      WHEN 'in_person' THEN
        bond_ok := COALESCE(NEW.bond_in_person_delivered, false);
      WHEN 'both' THEN
        bond_ok := COALESCE(NEW.bond_online_submitted, false) AND COALESCE(NEW.bond_in_person_delivered, false);
      ELSE
        bond_ok := false;
    END CASE;
  END IF;

  -- 2. Job Walk Section
  -- If job_walk_mandatory = false → satisfied
  -- If job_walk_mandatory = true → job_walk_completed must be true
  IF NEW.job_walk_mandatory IS NULL OR NEW.job_walk_mandatory = false THEN
    job_walk_ok := true;
  ELSE
    job_walk_ok := COALESCE(NEW.job_walk_completed, false);
  END IF;

  -- 3. Addenda Section
  -- If addenda_issued = false → satisfied
  -- If addenda_issued = true → addenda_reviewed must be true
  IF NEW.addenda_issued IS NULL OR NEW.addenda_issued = false THEN
    addenda_ok := true;
  ELSE
    addenda_ok := COALESCE(NEW.addenda_reviewed, false);
  END IF;

  -- 4. Proposal Section
  -- All three must be true: proposal_prepared, proposal_signed, proposal_notarized
  proposal_ok := COALESCE(NEW.proposal_prepared, false) 
                 AND COALESCE(NEW.proposal_signed, false) 
                 AND COALESCE(NEW.proposal_notarized, false);

  -- 5. Bid Sheet Section
  -- bid_sheet_complete must be true
  bid_sheet_ok := COALESCE(NEW.bid_sheet_complete, false);

  -- Ready = ALL 5 sections satisfied
  all_ready := bond_ok AND job_walk_ok AND addenda_ok AND proposal_ok AND bid_sheet_ok;

  -- Update the projects table with the computed readiness
  UPDATE projects
  SET is_ready_to_bid = all_ready
  WHERE id = NEW.project_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically update readiness on checklist changes
DROP TRIGGER IF EXISTS update_project_bid_readiness ON project_bid_readiness;
CREATE TRIGGER update_project_bid_readiness
AFTER INSERT OR UPDATE ON project_bid_readiness
FOR EACH ROW
EXECUTE FUNCTION evaluate_bid_readiness();