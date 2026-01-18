import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Circle, AlertCircle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface BidReadinessData {
  project_id: string;
  bond_required: boolean | null;
  bond_delivery_method: string | null;
  bond_online_submitted: boolean | null;
  bond_in_person_delivered: boolean | null;
  job_walk_mandatory: boolean | null;
  job_walk_completed: boolean | null;
  job_walk_attended_by: string | null;
  addenda_issued: boolean | null;
  addenda_reviewed: boolean | null;
  addenda_reviewed_at: string | null;
  proposal_prepared: boolean | null;
  proposal_signed: boolean | null;
  proposal_notarized: boolean | null;
  bid_sheet_complete: boolean | null;
}

interface BidReadinessChecklistProps {
  projectId: string;
}

type SectionStatus = "green" | "yellow" | "red" | "gray";

const StatusIcon = ({ status, className }: { status: SectionStatus; className?: string }) => {
  switch (status) {
    case "green":
      return <CheckCircle2 className={cn("h-5 w-5 text-green-500", className)} />;
    case "yellow":
      return <AlertCircle className={cn("h-5 w-5 text-yellow-500", className)} />;
    case "red":
      return <Circle className={cn("h-5 w-5 text-red-500 fill-red-500", className)} />;
    case "gray":
      return <MinusCircle className={cn("h-5 w-5 text-muted-foreground", className)} />;
  }
};

export function BidReadinessChecklist({ projectId }: BidReadinessChecklistProps) {
  const { toast } = useToast();
  const [data, setData] = useState<BidReadinessData>({
    project_id: projectId,
    bond_required: null,
    bond_delivery_method: null,
    bond_online_submitted: null,
    bond_in_person_delivered: null,
    job_walk_mandatory: null,
    job_walk_completed: null,
    job_walk_attended_by: null,
    addenda_issued: null,
    addenda_reviewed: null,
    addenda_reviewed_at: null,
    proposal_prepared: null,
    proposal_signed: null,
    proposal_notarized: null,
    bid_sheet_complete: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReadiness();
  }, [projectId]);

  const loadReadiness = async () => {
    // Use type assertion since this is a new table not yet in generated types
    const { data: existing, error } = await supabase
      .from("project_bid_readiness" as any)
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    if (error) {
      console.error("Error loading readiness:", error);
    } else if (existing) {
      setData(existing as unknown as BidReadinessData);
    }
    setLoading(false);
  };

  const saveReadiness = useCallback(async (updates: Partial<BidReadinessData>) => {
    const newData = { ...data, ...updates, updated_at: new Date().toISOString() };
    setData(newData);

    // Use type assertion since this is a new table not yet in generated types
    const { error } = await supabase
      .from("project_bid_readiness" as any)
      .upsert(newData as any, { onConflict: "project_id" });

    if (error) {
      console.error("Error saving readiness:", error);
      toast({
        title: "Error",
        description: "Failed to save checklist",
        variant: "destructive",
      });
    }
  }, [data, toast]);

  // Status computation functions
  const getBondStatus = (): SectionStatus => {
    if (data.bond_required === false) return "gray";
    if (data.bond_required === null) return "gray";
    
    const method = data.bond_delivery_method;
    if (!method) return "red";
    
    if (method === "online") {
      return data.bond_online_submitted ? "green" : "red";
    }
    if (method === "in_person") {
      return data.bond_in_person_delivered ? "green" : "red";
    }
    if (method === "both") {
      if (data.bond_online_submitted && data.bond_in_person_delivered) return "green";
      if (data.bond_online_submitted || data.bond_in_person_delivered) return "yellow";
      return "red";
    }
    return "gray";
  };

  const getJobWalkStatus = (): SectionStatus => {
    if (data.job_walk_mandatory === null) return "gray";
    if (data.job_walk_mandatory === false) return "gray";
    return data.job_walk_completed ? "green" : "red";
  };

  const getAddendaStatus = (): SectionStatus => {
    if (data.addenda_issued === null) return "gray";
    if (data.addenda_issued === false) return "gray";
    return data.addenda_reviewed ? "green" : "red";
  };

  const getProposalStatus = (): SectionStatus => {
    if (data.proposal_prepared === null && data.proposal_signed === null && data.proposal_notarized === null) {
      return "gray";
    }
    if (data.proposal_prepared && data.proposal_signed && data.proposal_notarized) return "green";
    if (data.proposal_prepared || data.proposal_signed || data.proposal_notarized) return "yellow";
    return "red";
  };

  const getBidSheetStatus = (): SectionStatus => {
    if (data.bid_sheet_complete === null) return "gray";
    return data.bid_sheet_complete ? "green" : "red";
  };

  const getOverallStatus = () => {
    const statuses = [
      getBondStatus(),
      getJobWalkStatus(),
      getAddendaStatus(),
      getProposalStatus(),
      getBidSheetStatus(),
    ];
    
    const greenCount = statuses.filter(s => s === "green").length;
    
    // ONLY ready if ALL 5 sections are green
    if (greenCount === 5) {
      return { ready: true, message: "READY TO BID" };
    }
    
    const notGreenCount = 5 - greenCount;
    return { 
      ready: false, 
      message: `NOT READY TO BID (${notGreenCount} item${notGreenCount > 1 ? "s" : ""} remaining)` 
    };
  };

  if (loading) {
    return (
      <Card className="mb-4 border-muted">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Loading checklist...</p>
        </CardContent>
      </Card>
    );
  }

  const overallStatus = getOverallStatus();

  return (
    <Card className="mb-4 border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Bid Readiness Checklist
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="multiple" className="w-full">
          {/* Bid Bond Section */}
          <AccordionItem value="bond" className="border-b-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-3">
                <StatusIcon status={getBondStatus()} />
                <span className="font-medium">Bid Bond</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-8 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">Bond Required?</Label>
                <RadioGroup
                  value={data.bond_required === null ? "" : data.bond_required ? "yes" : "no"}
                  onValueChange={(val) => saveReadiness({ 
                    bond_required: val === "yes",
                    ...(val === "no" ? { bond_delivery_method: null, bond_online_submitted: null, bond_in_person_delivered: null } : {})
                  })}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="bond-yes" />
                    <Label htmlFor="bond-yes" className="font-normal">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="bond-no" />
                    <Label htmlFor="bond-no" className="font-normal">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {data.bond_required && (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm">Delivery Method</Label>
                    <RadioGroup
                      value={data.bond_delivery_method || ""}
                      onValueChange={(val) => saveReadiness({ bond_delivery_method: val })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="online" id="bond-online" />
                        <Label htmlFor="bond-online" className="font-normal">Online</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="in_person" id="bond-in-person" />
                        <Label htmlFor="bond-in-person" className="font-normal">In-Person</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="both" id="bond-both" />
                        <Label htmlFor="bond-both" className="font-normal">Both</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {(data.bond_delivery_method === "online" || data.bond_delivery_method === "both") && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="bond-online-submitted"
                        checked={data.bond_online_submitted || false}
                        onCheckedChange={(checked) => saveReadiness({ bond_online_submitted: !!checked })}
                      />
                      <Label htmlFor="bond-online-submitted" className="font-normal">Online Submitted</Label>
                    </div>
                  )}

                  {(data.bond_delivery_method === "in_person" || data.bond_delivery_method === "both") && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="bond-in-person-delivered"
                        checked={data.bond_in_person_delivered || false}
                        onCheckedChange={(checked) => saveReadiness({ bond_in_person_delivered: !!checked })}
                      />
                      <Label htmlFor="bond-in-person-delivered" className="font-normal">In-Person Delivered</Label>
                    </div>
                  )}
                </>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Job Walk Section */}
          <AccordionItem value="jobwalk" className="border-b-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-3">
                <StatusIcon status={getJobWalkStatus()} />
                <span className="font-medium">Pre-Bid / Job Walk</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-8 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">Is Job Walk Mandatory?</Label>
                <RadioGroup
                  value={data.job_walk_mandatory === null ? "" : data.job_walk_mandatory ? "yes" : "no"}
                  onValueChange={(val) => saveReadiness({ 
                    job_walk_mandatory: val === "yes",
                    ...(val === "no" ? { job_walk_completed: null, job_walk_attended_by: null } : {})
                  })}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="walk-yes" />
                    <Label htmlFor="walk-yes" className="font-normal">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="walk-no" />
                    <Label htmlFor="walk-no" className="font-normal">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {data.job_walk_mandatory && (
                <>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="walk-completed"
                      checked={data.job_walk_completed || false}
                      onCheckedChange={(checked) => saveReadiness({ job_walk_completed: !!checked })}
                    />
                    <Label htmlFor="walk-completed" className="font-normal">Job Walk Completed</Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="walk-attended" className="text-sm">Attended By (optional)</Label>
                    <Input
                      id="walk-attended"
                      value={data.job_walk_attended_by || ""}
                      onChange={(e) => saveReadiness({ job_walk_attended_by: e.target.value || null })}
                      placeholder="e.g. John Smith"
                      className="max-w-xs"
                    />
                  </div>
                </>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Addenda Section */}
          <AccordionItem value="addenda" className="border-b-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-3">
                <StatusIcon status={getAddendaStatus()} />
                <span className="font-medium">Addenda Review</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-8 space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">Are There Addenda?</Label>
                <RadioGroup
                  value={data.addenda_issued === null ? "" : data.addenda_issued ? "yes" : "no"}
                  onValueChange={(val) => saveReadiness({ 
                    addenda_issued: val === "yes",
                    ...(val === "no" ? { addenda_reviewed: null, addenda_reviewed_at: null } : {})
                  })}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="addenda-yes" />
                    <Label htmlFor="addenda-yes" className="font-normal">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="addenda-no" />
                    <Label htmlFor="addenda-no" className="font-normal">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {data.addenda_issued && (
                <>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="addenda-reviewed"
                      checked={data.addenda_reviewed || false}
                      onCheckedChange={(checked) => saveReadiness({ addenda_reviewed: !!checked })}
                    />
                    <Label htmlFor="addenda-reviewed" className="font-normal">Addenda Reviewed</Label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="addenda-date" className="text-sm">Reviewed On (optional)</Label>
                    <Input
                      id="addenda-date"
                      type="date"
                      value={data.addenda_reviewed_at ? data.addenda_reviewed_at.split("T")[0] : ""}
                      onChange={(e) => saveReadiness({ addenda_reviewed_at: e.target.value || null })}
                      className="max-w-xs"
                    />
                  </div>
                </>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Bid Proposal Section */}
          <AccordionItem value="proposal" className="border-b-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-3">
                <StatusIcon status={getProposalStatus()} />
                <span className="font-medium">Bid Proposal</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-8 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="proposal-prepared"
                  checked={data.proposal_prepared || false}
                  onCheckedChange={(checked) => saveReadiness({ proposal_prepared: !!checked })}
                />
                <Label htmlFor="proposal-prepared" className="font-normal">Proposal Prepared</Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="proposal-signed"
                  checked={data.proposal_signed || false}
                  onCheckedChange={(checked) => saveReadiness({ proposal_signed: !!checked })}
                />
                <Label htmlFor="proposal-signed" className="font-normal">Signed</Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="proposal-notarized"
                  checked={data.proposal_notarized || false}
                  onCheckedChange={(checked) => saveReadiness({ proposal_notarized: !!checked })}
                />
                <Label htmlFor="proposal-notarized" className="font-normal">Notarized</Label>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Bid Sheet Section */}
          <AccordionItem value="bidsheet" className="border-b-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-3">
                <StatusIcon status={getBidSheetStatus()} />
                <span className="font-medium">Bid Sheet</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pl-8 space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="bidsheet-complete"
                  checked={data.bid_sheet_complete || false}
                  onCheckedChange={(checked) => saveReadiness({ bid_sheet_complete: !!checked })}
                />
                <Label htmlFor="bidsheet-complete" className="font-normal">Bid Sheet Complete</Label>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Overall Status Bar */}
        <div className={cn(
          "mt-4 py-2 px-3 rounded-md text-sm font-medium text-center",
          overallStatus.ready 
            ? "bg-green-500/10 text-green-600 border border-green-500/20" 
            : "bg-red-500/10 text-red-600 border border-red-500/20"
        )}>
          {overallStatus.message}
        </div>
      </CardContent>
    </Card>
  );
}
