import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

interface HighSignalPanelProps {
  project: {
    job_walk_exists?: boolean | null;
    job_walk_mandatory?: boolean | null;
    job_walk_at?: string | null;
    job_walk_details?: string | null;
    eligibility_restricted?: boolean | null;
    eligibility_notes?: string | null;
    documents_visible?: boolean | null;
    documents_accessible?: boolean | null;
    crawl_snapshot?: any;
    timezone?: string | null;
  };
}

export function HighSignalPanel({ project }: HighSignalPanelProps) {
  // Check if any high-signal data exists
  const hasJobWalkData = project.job_walk_exists !== null;
  const hasEligibilityData = project.eligibility_restricted !== null;
  const hasDocumentsData = project.documents_visible !== null || project.documents_accessible !== null;
  
  const hasAnyData = hasJobWalkData || hasEligibilityData || hasDocumentsData;
  
  if (!hasAnyData) {
    return null;
  }

  const timezone = project.timezone || "America/Los_Angeles";

  // Format job walk date/time
  const formatJobWalkDate = () => {
    if (!project.job_walk_at) return null;
    try {
      const date = new Date(project.job_walk_at);
      return formatInTimeZone(date, timezone, "MMM d, yyyy · h:mm a zzz");
    } catch {
      return null;
    }
  };

  // Render Job Walk section
  const renderJobWalk = () => {
    if (project.job_walk_exists === null) {
      return <span className="text-muted-foreground">Not detected</span>;
    }
    
    if (project.job_walk_exists === false) {
      return <span className="text-muted-foreground">None mentioned</span>;
    }

    const isMandatory = project.job_walk_mandatory === true;
    const isOptional = project.job_walk_mandatory === false;
    const formattedDate = formatJobWalkDate();

    return (
      <div className="space-y-0.5">
        <span className={isMandatory ? "text-destructive font-medium" : ""}>
          {isMandatory ? "Mandatory" : isOptional ? "Optional" : "Mentioned"}
          {!isMandatory && !isOptional && " – check source"}
        </span>
        {formattedDate && (
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
        )}
        {project.job_walk_details && (
          <p className="text-sm text-muted-foreground">{project.job_walk_details}</p>
        )}
        {isMandatory && !formattedDate && (
          <p className="text-sm text-muted-foreground">Details not detected</p>
        )}
      </div>
    );
  };

  // Render Eligibility section
  const renderEligibility = () => {
    if (project.eligibility_restricted === null) {
      return <span className="text-muted-foreground">Not detected</span>;
    }
    
    if (project.eligibility_restricted === false) {
      return <span className="text-muted-foreground">None</span>;
    }

    return (
      <div className="space-y-0.5">
        <span className="text-destructive font-medium">Restricted</span>
        {project.eligibility_notes && (
          <p className="text-sm text-muted-foreground">{project.eligibility_notes}</p>
        )}
      </div>
    );
  };

  // Render Documents section
  const renderDocuments = () => {
    if (project.documents_visible === null && project.documents_accessible === null) {
      return <span className="text-muted-foreground">Not detected</span>;
    }

    if (project.documents_visible === true && project.documents_accessible === true) {
      return <span className="text-green-600">Publicly accessible</span>;
    }

    if (project.documents_visible === true && project.documents_accessible === false) {
      return <span className="text-muted-foreground">Login required to download</span>;
    }

    if (project.documents_visible === false) {
      return <span className="text-muted-foreground">Not listed on source</span>;
    }

    return <span className="text-muted-foreground">Not detected</span>;
  };

  return (
    <Card className="mb-4 bg-muted/30 border-muted">
      <CardContent className="pt-4 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Job Walk */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Job Walk
            </Label>
            <div className="text-sm">{renderJobWalk()}</div>
          </div>

          {/* Eligibility Restrictions */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Eligibility Restrictions
            </Label>
            <div className="text-sm">{renderEligibility()}</div>
          </div>

          {/* Documents Access */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Documents Access
            </Label>
            <div className="text-sm">{renderDocuments()}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
