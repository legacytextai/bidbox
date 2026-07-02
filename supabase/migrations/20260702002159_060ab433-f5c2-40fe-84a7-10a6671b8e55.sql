UPDATE opportunity_sources
   SET scan_enabled = true,
       refresh_enabled = true
 WHERE portal_type = 'lacounty_dpw';