-- P0 data correctness: PlanetBids and Caltrans bid items are portal-authoritative.
-- Existing rows are not backfilled here. NOT VALID avoids scanning historical data
-- while still enforcing the invariant for new or updated rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'opportunity_bid_items_portal_authoritative_chk'
      AND conrelid = 'public.opportunity_bid_items'::regclass
  ) THEN
    ALTER TABLE public.opportunity_bid_items
      ADD CONSTRAINT opportunity_bid_items_portal_authoritative_chk
      CHECK (
        source_portal IS NULL
        OR lower(source_portal) NOT IN ('planetbids', 'caltrans')
        OR extraction_method = 'portal_tab'
      ) NOT VALID;
  END IF;
END $$;
