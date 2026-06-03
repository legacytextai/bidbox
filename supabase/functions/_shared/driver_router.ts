import { DriverContext, OpportunityDriver, OpportunitySource, ScanResult } from "./opportunity_driver.ts";
import { FirecrawlDriver } from "./firecrawl_driver.ts";
import { PlanetBidsDriver } from "./planetbids_driver.ts";

function resolveDriver(source: OpportunitySource): OpportunityDriver {
  switch (source.portal_type) {
    case "planetbids":
      return new PlanetBidsDriver();
    case "caltrans":
    case "simple_html":
    default:
      return new FirecrawlDriver();
  }
}

export function runDriver(source: OpportunitySource, context: DriverContext): Promise<ScanResult> {
  return resolveDriver(source).scan(source, context);
}
