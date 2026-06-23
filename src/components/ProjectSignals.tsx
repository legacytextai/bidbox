import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  AlertTriangle, 
  Lock, 
  ShieldAlert, 
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  HelpCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { getPortalDisplayName, PortalType } from "@/lib/platformDetection";
import { formatProjectDateTime } from "@/lib/timezoneUtils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProjectSignalsProps {
  project: {
    source_url?: string | null;
    portal_type?: string | null;
    last_crawled_at?: string | null;
    job_walk_exists?: boolean | null;
    job_walk_mandatory?: boolean | null;
    job_walk_details?: string | null;
    eligibility_restricted?: boolean | null;
    eligibility_notes?: string | null;
    documents_visible?: boolean | null;
    documents_accessible?: boolean | null;
  };
  className?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function ProjectSignals({ project, className, onRefresh, isRefreshing }: ProjectSignalsProps) {
  const hasSourceUrl = !!project.source_url;
  
  if (!hasSourceUrl) {
    return null;
  }

  const signals: React.ReactNode[] = [];

  // Job Walk Signal
  if (project.job_walk_exists === true) {
    const isMandatory = project.job_walk_mandatory === true;
    const isUnknown = project.job_walk_mandatory === null;
    
    signals.push(
      <TooltipProvider key="job-walk">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className={cn(
                "gap-1.5 cursor-help",
                isMandatory 
                  ? "border-destructive text-destructive bg-destructive/10" 
                  : "border-warning text-warning bg-warning/10"
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              Job Walk {isMandatory ? "(Mandatory)" : isUnknown ? "(Check Requirements)" : ""}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium">Job Walk Mentioned</p>
            {project.job_walk_details && (
              <p className="text-sm text-muted-foreground mt-1">{project.job_walk_details}</p>
            )}
            {isMandatory && (
              <p className="text-sm text-destructive mt-1">Attendance is required for bid eligibility</p>
            )}
            {isUnknown && (
              <p className="text-sm text-muted-foreground mt-1">Check source for mandatory status</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Documents Gated Signal
  if (project.documents_visible === true && project.documents_accessible === false) {
    signals.push(
      <TooltipProvider key="docs-gated">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className="gap-1.5 cursor-help border-muted-foreground text-muted-foreground"
            >
              <Lock className="h-3 w-3" />
              Documents Gated
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Documents are listed but require login to download</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Eligibility Restricted Signal
  if (project.eligibility_restricted === true) {
    signals.push(
      <TooltipProvider key="eligibility">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className="gap-1.5 cursor-help border-destructive text-destructive bg-destructive/10"
            >
              <ShieldAlert className="h-3 w-3" />
              Restricted Eligibility
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium">Bidder Restrictions Apply</p>
            {project.eligibility_notes && (
              <p className="text-sm text-muted-foreground mt-1">{project.eligibility_notes}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Last Crawled Signal with staleness colors
  if (project.last_crawled_at) {
    const lastChecked = new Date(project.last_crawled_at);
    const hoursSinceCheck = (Date.now() - lastChecked.getTime()) / (1000 * 60 * 60);
    
    // Determine staleness level
    let stalenessClass = "border-green-500 text-green-600 bg-green-50"; // Within 24 hours
    let stalenessIcon = <CheckCircle2 className="h-3 w-3" />;
    
    if (hoursSinceCheck > 72) {
      // More than 3 days - gray (stale)
      stalenessClass = "border-muted-foreground/50 text-muted-foreground bg-muted/50";
      stalenessIcon = <RefreshCw className="h-3 w-3" />;
    } else if (hoursSinceCheck > 24) {
      // 1-3 days - yellow (getting stale)
      stalenessClass = "border-yellow-500 text-yellow-600 bg-yellow-50";
      stalenessIcon = <RefreshCw className="h-3 w-3" />;
    }
    
    signals.push(
      <div key="last-checked" className="flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={cn("gap-1.5 cursor-help", stalenessClass)}>
                {stalenessIcon}
                Checked {formatDistanceToNow(lastChecked, { addSuffix: true })}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Last synced with source: {formatProjectDateTime(project.last_crawled_at, { fallback: "Unknown" })}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {onRefresh && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="gap-1.5 cursor-pointer hover:bg-muted transition-colors border-muted-foreground/50 text-muted-foreground"
                  onClick={onRefresh}
                >
                  <RefreshCw className={cn("h-3 w-3", isRefreshing && "animate-spin")} />
                  {isRefreshing ? "Refreshing" : "Refresh"}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Sync with source to check for updates</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Prominent Source Link Section */}
      <a 
        href={project.source_url!} 
        target="_blank" 
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border hover:bg-muted/80 hover:border-primary/50 transition-colors cursor-pointer group"
      >
        <ExternalLink className="h-5 w-5 text-primary flex-shrink-0 group-hover:scale-110 transition-transform" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Project Link</p>
          <p className="text-sm text-muted-foreground truncate">
            {project.portal_type 
              ? getPortalDisplayName(project.portal_type as PortalType)
              : new URL(project.source_url!).hostname
            }
          </p>
        </div>
        <span className="text-sm text-primary group-hover:underline">
          Open
        </span>
      </a>
      
      {/* Signal Badges */}
      {signals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {signals}
        </div>
      )}
    </div>
  );
}
