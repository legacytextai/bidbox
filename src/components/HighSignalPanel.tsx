import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatProjectDateTimeOrNull } from "@/lib/timezoneUtils";

interface HighSignalPanelProps {
  project: {
    job_walk_exists?: boolean | null;
    job_walk_mandatory?: boolean | null;
    job_walk_at?: string | null;
    job_walk_details?: string | null;
    eligibility_restricted?: boolean | null;
    eligibility_notes?: string | null;
    crawl_snapshot?: any;
    timezone?: string | null;
  };
}

export function HighSignalPanel({ project }: HighSignalPanelProps) {
  // Always show panel for One Link projects - placeholder fields ensure content
  // Future: Engineer's Estimate, Bond Requirements, and Addenda extraction not yet implemented

  const timezone = project.timezone || "America/Los_Angeles";

  // Format job walk date/time
  const formatJobWalkDate = () => {
    if (!project.job_walk_at) return null;
    return formatProjectDateTimeOrNull(project.job_walk_at, { timezone });
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

  // Engineer's Estimate
  const renderEngineersEstimate = () => {
    const estimate = project.crawl_snapshot?.semantic?.engineers_estimate;
    if (!estimate?.amount) {
      return <span className="text-muted-foreground">Not detected</span>;
    }
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: estimate.currency || 'USD',
      maximumFractionDigits: 0
    }).format(estimate.amount);
    return <span>{formatted}</span>;
  };

  // Bond Requirements
  const renderBondRequirements = () => {
    const bonds = project.crawl_snapshot?.semantic?.bonds;
    if (!bonds?.bid_bond_percent && !bonds?.payment_bond_percent && !bonds?.performance_bond_percent) {
      return <span className="text-muted-foreground">Not detected</span>;
    }
    const parts: string[] = [];
    if (bonds.bid_bond_percent != null) parts.push(`Bid: ${bonds.bid_bond_percent}%`);
    if (bonds.payment_bond_percent != null) parts.push(`Payment: ${bonds.payment_bond_percent}%`);
    if (bonds.performance_bond_percent != null) parts.push(`Performance: ${bonds.performance_bond_percent}%`);
    return (
      <div className="space-y-0.5">
        <span>{parts.join(' · ')}</span>
        {bonds.notes && (
          <p className="text-xs text-muted-foreground">{bonds.notes}</p>
        )}
      </div>
    );
  };

  // Addenda
  const renderAddenda = () => {
    const addenda = project.crawl_snapshot?.semantic?.addenda;
    if (addenda?.count == null) {
      return <span className="text-muted-foreground">Not detected</span>;
    }
    if (addenda.count === 0) {
      return <span className="text-muted-foreground">None</span>;
    }
    return (
      <div className="space-y-0.5">
        <span>{addenda.count} addend{addenda.count === 1 ? 'um' : 'a'}</span>
        {addenda.details && (
          <p className="text-xs text-muted-foreground">{addenda.details}</p>
        )}
      </div>
    );
  };

  return (
    <Card className="mb-4 bg-muted/30 border-muted">
      <CardContent className="pt-4 pb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
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

          {/* Engineer's Estimate */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Engineer's Estimate
            </Label>
            <div className="text-sm">{renderEngineersEstimate()}</div>
          </div>

          {/* Bond Requirements */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Bond Requirements
            </Label>
            <div className="text-sm">{renderBondRequirements()}</div>
          </div>

          {/* Addenda */}
          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Addenda
            </Label>
            <div className="text-sm">{renderAddenda()}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
