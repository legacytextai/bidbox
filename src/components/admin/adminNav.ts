import type { LucideIcon } from "lucide-react";
import { Radar, BarChart3, Globe } from "lucide-react";

/**
 * Admin section navigation registry.
 *
 * The Admin section is BidBox's internal operating center. Future
 * dashboards (Source Health drill-down, Scan Queue, Worker Health,
 * Document Acquisition, Intelligence Pipeline, Portal/Agency Registry,
 * System Metrics, ...) are added by appending one entry here — the
 * sidebar and any future admin index page render from this list.
 *
 * Convention: every admin route lives under /admin/* and every admin
 * page wraps itself in <AdminGuard>.
 */
export interface AdminNavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  description: string;
}

export const ADMIN_NAV: AdminNavItem[] = [
  {
    title: "Coverage",
    path: "/admin/coverage",
    icon: Radar,
    description: "Agency coverage, source health, driver health, expansion progress, operations",
  },
  {
    title: "Analytics",
    path: "/admin/analytics",
    icon: BarChart3,
    description: "Customer KPIs and GC metrics",
  },
  {
    title: "Network Subs",
    path: "/admin/network-subs",
    icon: Globe,
    description: "Curated network subcontractor pool management",
  },
];
