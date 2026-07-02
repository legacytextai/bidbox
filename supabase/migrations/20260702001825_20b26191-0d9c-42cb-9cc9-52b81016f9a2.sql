INSERT INTO agent_tasks (task_type, status, priority, payload, trigger_reason)
VALUES (
  'lacounty_dpw_scan',
  'pending',
  10,
  jsonb_build_object(
    'source_id',      '577ce819-8aa8-4ff8-b357-559277ce1a82',
    'listing_url',    'https://dpw.lacounty.gov/contracts/Opportunities.aspx',
    'portal_type',    'lacounty_dpw',
    'source_name',    'Los Angeles County Department of Public Works',
    'trigger_reason', 'validation_manual'
  ),
  'validation_manual'
);