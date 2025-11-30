import { 
  Users, 
  UserCheck, 
  FolderOpen, 
  BarChart3, 
  FileText, 
  TrendingUp, 
  Percent, 
  Eye 
} from "lucide-react";
import { KPICard } from "./KPICard";
import { KPISummary } from "@/hooks/useAdminKPIs";

interface KPIGridProps {
  data: KPISummary | null | undefined;
  isLoading: boolean;
}

export function KPIGrid({ data, isLoading }: KPIGridProps) {
  const kpis = [
    {
      title: "Total GCs",
      value: data?.total_gcs,
      icon: Users,
      format: "number" as const,
    },
    {
      title: "Active GCs (30d)",
      value: data?.active_gcs_30d,
      icon: UserCheck,
      format: "number" as const,
    },
    {
      title: "Total Projects",
      value: data?.total_projects,
      icon: FolderOpen,
      format: "number" as const,
    },
    {
      title: "Avg Projects/GC",
      value: data?.avg_projects_per_gc,
      icon: BarChart3,
      format: "decimal" as const,
    },
    {
      title: "Total Bids",
      value: data?.total_bids,
      icon: FileText,
      format: "number" as const,
    },
    {
      title: "Avg Bids/Project",
      value: data?.avg_bids_per_project,
      icon: TrendingUp,
      format: "decimal" as const,
    },
    {
      title: "Conversion Rate",
      value: data?.conversion_rate,
      icon: Percent,
      format: "percentage" as const,
      tooltip: data 
        ? `(Projects with Bids ÷ Total Projects) × 100\n(${data.projects_with_bids} ÷ ${data.total_projects}) × 100 = ${data.conversion_rate}%`
        : "(Projects with Bids ÷ Total Projects) × 100",
    },
    {
      title: "Bid Room Views",
      value: data?.total_views,
      icon: Eye,
      format: "number" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <KPICard
          key={kpi.title}
          title={kpi.title}
          value={kpi.value}
          icon={kpi.icon}
          format={kpi.format}
          isLoading={isLoading}
          tooltip={kpi.tooltip}
        />
      ))}
    </div>
  );
}
