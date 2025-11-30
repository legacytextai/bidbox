import { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface KPICardProps {
  title: string;
  value: number | string | null | undefined;
  icon: LucideIcon;
  format?: "number" | "percentage" | "decimal";
  isLoading?: boolean;
  tooltip?: string;
}

export function KPICard({ title, value, icon: Icon, format = "number", isLoading, tooltip }: KPICardProps) {
  const formatValue = (val: number | string | null | undefined) => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "string") return val;
    
    switch (format) {
      case "percentage":
        return `${val.toFixed(1)}%`;
      case "decimal":
        return val.toFixed(2);
      default:
        return val.toLocaleString();
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16" />
        </CardContent>
      </Card>
    );
  }

  const cardContent = (
    <Card className="bg-card border-border hover:border-primary/30 transition-colors">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">
          {formatValue(value)}
        </div>
      </CardContent>
    </Card>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {cardContent}
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return cardContent;
}
