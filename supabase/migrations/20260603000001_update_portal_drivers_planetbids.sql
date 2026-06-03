UPDATE public.portal_drivers
SET
  driver_name = 'planetbids_driver',
  driver_mode = 'browserbase',
  updated_at  = now()
WHERE portal_type = 'planetbids';
