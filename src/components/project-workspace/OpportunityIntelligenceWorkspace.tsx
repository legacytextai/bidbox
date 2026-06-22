import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { FileDropzone } from "@/components/FileDropzone";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { BidReadinessChecklist } from "@/components/BidReadinessChecklist";
import { BidListButton } from "@/components/BidListButton";
import { CallListButton } from "@/components/CallListButton";
import { TradeType, getCategoryColor } from "@/lib/tradeTypes";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

interface Submission {
  submission_id: string;
  submitted_at: string;
  bidder_name?: string;
  company_name?: string;
  email?: string;
  bid_item?: string;
  files: {
    file_name: string;
    file_url: string;
  }[];
}

interface ProjectTrade {
  id: string;
  trade_type_id: string;
  trade_types: TradeType;
}

interface SourceOpportunity {
  id: string;
  raw_title: string | null;
  agency: string | null;
  crawl_data: any | null;
}

interface IntelligenceReport {
  id: string;
  title: string | null;
  executive_summary: any;
  status: string;
}

interface IntelligenceFinding {
  id: string;
  category: string;
  field_key: string;
  label: string;
  value_text: string | null;
  value_jsonb: any | null;
  status: string;
  confidence: string;
  is_critical: boolean;
  sort_order: number;
}

interface OpportunityDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  document_family: string | null;
  document_class: string | null;
  acquisition_status: string;
  processing_status: string;
  storage_bucket: string;
  storage_path: string | null;
  source_url: string | null;
}

interface OpportunityIntelligenceWorkspaceProps {
  project: any;
  sourceOpportunity: SourceOpportunity | null;
  intelligenceReport: IntelligenceReport | null;
  findings: IntelligenceFinding[];
  opportunityDocuments: OpportunityDocument[];
  projectFiles: ProjectFile[];
  projectTrades: ProjectTrade[];
  submissions: Submission[];
  copied: boolean;
  newFiles: File[];
  currentUpload: string | null;
  isUploading: boolean;
  editingTrades: boolean;
  editedTradeIds: string[];
  savingTrades: boolean;
  onCopyBidLink: () => void;
  onFilesSelected: (files: File[]) => void;
  onUploadFiles: () => void;
  onDownloadInternalFile: (filePath: string, fileName: string) => void;
  onDeleteInternalFile: (fileId: string, filePath: string) => void;
  onDownloadBid: (filePath: string, fileName: string) => void;
  onDeleteSubmission: (submissionId: string) => void;
  onEditingTradesChange: (open: boolean) => void;
  onEditedTradeIdsChange: (ids: string[]) => void;
  onSaveTrades: () => void;
}

const formatDateTime = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "MMM d, yyyy h:mm a") : "Not available";

const formatCurrency = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return null;
};

const formatFileSize = (size: number | null) => {
  if (!size) return "Size unavailable";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getExecutiveBulletText = (bullet: any) => {
  if (typeof bullet === "string") return bullet;
  if (typeof bullet?.text === "string") return bullet.text;
  return null;
};

const normalizeLabel = (value: string) =>
  value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const getFindingValue = (finding: IntelligenceFinding | undefined) => {
  if (!finding) return null;
  if (finding.status !== "found" && finding.status !== "needs_review" && finding.status !== "conflict") return null;
  return finding.value_text || null;
};

const findFirst = (findings: IntelligenceFinding[], keys: string[], categories?: string[]) =>
  findings.find((finding) => {
    const keyMatches = keys.some((key) =>
      finding.field_key?.toLowerCase().includes(key) ||
      finding.label?.toLowerCase().includes(key),
    );
    const categoryMatches = !categories || categories.includes(finding.category);
    return keyMatches && categoryMatches;
  });

export function OpportunityIntelligenceWorkspace({
  project,
  sourceOpportunity,
  intelligenceReport,
  findings,
  opportunityDocuments,
  projectFiles,
  projectTrades,
  submissions,
  copied,
  newFiles,
  currentUpload,
  isUploading,
  editingTrades,
  editedTradeIds,
  savingTrades,
  onCopyBidLink,
  onFilesSelected,
  onUploadFiles,
  onDownloadInternalFile,
  onDeleteInternalFile,
  onDownloadBid,
  onDeleteSubmission,
  onEditingTradesChange,
  onEditedTradeIdsChange,
  onSaveTrades,
}: OpportunityIntelligenceWorkspaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const reportOpportunityId = project.source_opportunity_candidate_id || sourceOpportunity?.id;
  const bidRoomUrl = `${window.location.origin}/bid/${project.public_token}`;

  const snapshot = useMemo(() => {
    const overviewBullet = Array.isArray(intelligenceReport?.executive_summary?.bullets)
      ? intelligenceReport.executive_summary.bullets
          .map(getExecutiveBulletText)
          .find((text): text is string => Boolean(text))
      : null;

    const projectOverview =
      overviewBullet?.replace(/^Project Overview:\s*/i, "") ||
      getFindingValue(findings.find((finding) => finding.category === "project_overview")) ||
      "Project overview is available in the full Intelligence Report.";

    const estimateFinding = findFirst(findings, ["engineer estimate", "engineer's estimate", "estimated value", "estimate"]);
    const licenseFinding = findFirst(findings, ["license"], ["bid_requirements", "project_overview"]);
    const durationFinding = findFirst(findings, ["duration", "calendar days", "working days"], ["key_dates", "bid_requirements"]);
    const damagesFinding = findFirst(findings, ["liquidated damages", "damages"], ["risk_flags", "bid_requirements"]);
    const jobWalkFinding = findFirst(findings, ["job walk", "pre-bid", "prebid"], ["key_dates"]);

    return {
      projectOverview,
      engineerEstimate:
        getFindingValue(estimateFinding) ||
        formatCurrency(sourceOpportunity?.crawl_data?.estimated_value) ||
        "Not available",
      requiredLicense:
        getFindingValue(licenseFinding) ||
        sourceOpportunity?.crawl_data?.license_requirements ||
        "Not available",
      contractDuration:
        getFindingValue(durationFinding) ||
        sourceOpportunity?.crawl_data?.contract_duration ||
        "Not available",
      liquidatedDamages:
        getFindingValue(damagesFinding) ||
        sourceOpportunity?.crawl_data?.liquidated_damages ||
        "Not available",
      bidDue:
        getFindingValue(findFirst(findings, ["bid due", "bid date", "deadline"], ["key_dates"])) ||
        formatDateTime(project.bid_due_at),
      jobWalk:
        getFindingValue(jobWalkFinding) ||
        formatDateTime(project.job_walk_at || sourceOpportunity?.crawl_data?.job_walk_at),
    };
  }, [findings, intelligenceReport, project.bid_due_at, project.job_walk_at, sourceOpportunity]);

  const highlighted = useMemo(() => {
    const found = findings.filter((finding) =>
      finding.status === "found" || finding.status === "needs_review" || finding.status === "conflict",
    );

    return {
      criticalRequirements: found
        .filter((finding) => finding.category === "bid_requirements" || finding.is_critical)
        .slice(0, 5),
      risks: found
        .filter((finding) => finding.category === "risk_flags")
        .slice(0, 5),
      trades: found
        .filter((finding) => finding.category === "trade_breakdown" || finding.category === "scope_summary")
        .slice(0, 5),
    };
  }, [findings]);

  const downloadSourceDocument = async (sourceDocument: OpportunityDocument) => {
    if (!sourceDocument.storage_path) {
      toast({
        title: "Document unavailable",
        description: "No stored file path is available for this source document.",
        variant: "destructive",
      });
      return;
    }

    const { data, error } = await supabase.storage
      .from(sourceDocument.storage_bucket || "opportunity-documents")
      .download(sourceDocument.storage_path);

    if (error || !data) {
      toast({
        title: "Download failed",
        description: "Could not download the source document.",
        variant: "destructive",
      });
      return;
    }

    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sourceDocument.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const renderFindingList = (items: IntelligenceFinding[], empty: string) => {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground">{empty}</p>;
    }

    return (
      <div className="space-y-3">
        {items.map((finding) => (
          <div key={finding.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{finding.label}</p>
              {finding.status !== "found" && (
                <Badge variant="outline" className="shrink-0">
                  {normalizeLabel(finding.status)}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {finding.value_text || "Review in full report."}
            </p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <Button variant="ghost" onClick={() => navigate("/projects")} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Projects
      </Button>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Opportunity Intelligence</Badge>
              <Badge variant="secondary">Active Pursuit</Badge>
              <Badge variant={project.status === "LIVE" ? "default" : "outline"}>
                {project.status === "LIVE" ? "Active Pursuit" : normalizeLabel(project.status || "Unknown")}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                {[project.agency, project.county].filter(Boolean).join(" · ") || "Agency details unavailable"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {reportOpportunityId && (
              <Button
                onClick={() => navigate(`/opportunities/${reportOpportunityId}`)}
                className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                View Intelligence Report
              </Button>
            )}
            {project.source_url && (
              <Button variant="outline" onClick={() => window.open(project.source_url, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Source Portal
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/calendar")}>
              <CalendarDays className="h-4 w-4 mr-2" />
              Open Calendar
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Due</p>
            <p className="font-medium">{snapshot.bidDue}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Job Walk</p>
            <p className="font-medium">{snapshot.jobWalk}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Report</p>
            <p className="font-medium">{intelligenceReport?.status ? normalizeLabel(intelligenceReport.status) : "Not linked"}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Pursuit Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Overview</p>
              <p className="mt-1 text-sm text-foreground">{snapshot.projectOverview}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Engineer Estimate</p>
                <p className="font-medium">{snapshot.engineerEstimate}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Required License</p>
                <p className="font-medium">{snapshot.requiredLicense}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Contract Duration</p>
                <p className="font-medium">{snapshot.contractDuration}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Liquidated Damages</p>
                <p className="font-medium">{snapshot.liquidatedDamages}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <BidReadinessChecklist projectId={project.id} />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle>Intelligence Highlights</CardTitle>
          {reportOpportunityId && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/opportunities/${reportOpportunityId}`)}>
              View Full Intelligence Report
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <h3 className="font-medium">Critical Requirements</h3>
            </div>
            {renderFindingList(highlighted.criticalRequirements, "No critical requirements surfaced yet.")}
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-medium">Risks</h3>
            </div>
            {renderFindingList(highlighted.risks, "No risks surfaced yet.")}
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <h3 className="font-medium">Trades & Scope</h3>
            </div>
            {renderFindingList(highlighted.trades, "No trade or scope highlights surfaced yet.")}
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Source Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {opportunityDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No acquired source documents are linked to this opportunity.</p>
            ) : (
              opportunityDocuments.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{document.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[normalizeLabel(document.document_family || "source document"), formatFileSize(document.file_size)].join(" · ")}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => downloadSourceDocument(document)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Internal Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {projectFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No internal working files uploaded yet.</p>
              ) : (
                projectFiles.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <p className="truncate text-sm font-medium">{file.file_name}</p>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onDownloadInternalFile(file.file_url, file.file_name)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete File</AlertDialogTitle>
                            <AlertDialogDescription>
                              Delete this internal working file? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDeleteInternalFile(file.id, file.file_url)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))
              )}
            </div>
            <FileDropzone
              onFilesSelected={onFilesSelected}
              accept=".pdf,.dwg,.xls,.xlsx"
              multiple={true}
              disabled={isUploading}
              className={`border-2 border-dashed border-border rounded-lg p-4 ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Upload className="h-4 w-4 mr-2 inline" />
              <span className="text-sm text-muted-foreground">
                {isUploading ? "Uploading..." : "Upload takeoffs, estimates, notes, or schedules"}
              </span>
            </FileDropzone>
            {newFiles.length > 0 && (
              <div className="space-y-3">
                {newFiles.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{file.name}</p>
                      {currentUpload === file.name && <span className="text-xs text-muted-foreground">(Uploading...)</span>}
                    </div>
                    {currentUpload === file.name && <div className="h-1 rounded bg-muted" />}
                  </div>
                ))}
                <Button onClick={onUploadFiles} size="sm" disabled={isUploading}>
                  Upload Files
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle>Required Trades</CardTitle>
          <Dialog open={editingTrades} onOpenChange={onEditingTradesChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Trades
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]" onWheel={(e) => e.stopPropagation()}>
              <DialogHeader>
                <DialogTitle>Edit Required Trades</DialogTitle>
                <DialogDescription>Select the trades required for this project.</DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <TradeMultiSelect selectedTradeIds={editedTradeIds} onSelectionChange={onEditedTradeIdsChange} stateCode="CA" />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    onEditedTradeIdsChange(projectTrades.map((trade) => trade.trade_type_id));
                    onEditingTradesChange(false);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={onSaveTrades} disabled={savingTrades}>
                  {savingTrades ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Trades"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {projectTrades.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {projectTrades.map((trade) => (
                <Badge key={trade.id} variant="outline" className={cn("px-2 py-1 text-xs font-medium border", getCategoryColor(trade.trade_types?.category))}>
                  <span className="font-mono mr-1">{trade.trade_types?.code}</span>
                  {trade.trade_types?.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No trades selected yet.</p>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coverage / Subs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projectTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add required trades to start tracking coverage.</p>
            ) : (
              projectTrades.map((trade) => {
                const quoteCount = submissions.filter((submission) =>
                  submission.bid_item === trade.trade_types?.name ||
                  submission.bid_item === trade.trade_types?.code,
                ).length;
                return (
                  <div key={trade.id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="font-medium">{trade.trade_types?.name}</p>
                      <p className="text-xs text-muted-foreground">Invites not tracked yet</p>
                    </div>
                    <Badge variant={quoteCount > 0 ? "default" : "outline"}>
                      {quoteCount} quote{quoteCount === 1 ? "" : "s"} received
                    </Badge>
                  </div>
                );
              })
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <CallListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} />
              <BidListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} projectCounty={project.county} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bid Room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Room Link</p>
              <p className="mt-1 break-all text-sm">{bidRoomUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onCopyBidLink}>
                  {copied ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copied" : "Copy Link"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(bidRoomUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Bid Room
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium">Submissions</h3>
                </div>
                <Badge variant="outline">{submissions.length}</Badge>
              </div>
              <div className="space-y-2">
                {submissions.length === 0 ? (
                  <p className="rounded-md border border-border p-4 text-center text-sm text-muted-foreground">
                    No bid submissions yet.
                  </p>
                ) : (
                  submissions.map((submission) => (
                    <div key={submission.submission_id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{submission.bidder_name || "Unknown Bidder"}</p>
                          {submission.company_name && <p className="text-sm text-muted-foreground">{submission.company_name}</p>}
                          {submission.bid_item && <p className="text-sm text-muted-foreground">Division: {submission.bid_item}</p>}
                          <p className="text-xs text-muted-foreground">{format(new Date(submission.submitted_at), "MMM d, yyyy h:mm a")}</p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Submission</AlertDialogTitle>
                              <AlertDialogDescription>
                                Delete this bid submission and its files? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDeleteSubmission(submission.submission_id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      <div className="mt-3 space-y-2">
                        {submission.files.map((file, index) => (
                          <Button key={`${submission.submission_id}-${index}`} variant="outline" size="sm" onClick={() => onDownloadBid(file.file_url, file.file_name)} className="w-full justify-start">
                            <Download className="h-4 w-4 mr-2" />
                            {file.file_name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
