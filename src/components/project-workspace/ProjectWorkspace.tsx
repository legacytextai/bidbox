// Project Workspace — tabbed execution workspace for opportunities added to calendar.
// Tasks 24-28: routing, data access, shell, overview, pursuit status.

import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOpportunityDossier } from "@/hooks/useOpportunityDossier";
import { OpportunityOverviewTab } from "@/components/OpportunityOverviewTab";
import { OpportunityDocumentsTab } from "@/components/OpportunityDocumentsTab";
import { BidReadinessChecklist } from "@/components/BidReadinessChecklist";
import { CallListButton } from "@/components/CallListButton";
import { BidListButton } from "@/components/BidListButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ExternalLink, CalendarDays, Sparkles, Trash2, Loader2 } from "lucide-react";

type PursuitStatus = "reviewing" | "pursuing" | "passed" | "submitted";

const PURSUIT_STATUS_LABELS: Record<PursuitStatus, string> = {
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  passed: "Passed",
  submitted: "Submitted",
};

const PURSUIT_STATUS_STYLES: Record<PursuitStatus, string> = {
  reviewing: "bg-muted text-muted-foreground",
  pursuing: "bg-blue-50 text-blue-700 border-blue-200",
  passed: "bg-gray-100 text-gray-500",
  submitted: "bg-green-50 text-green-700 border-green-200",
};

type TabKey =
  | "overview"
  | "bid_readiness"
  | "documents"
  | "intelligence"
  | "coverage"
  | "addenda"
  | "activity"
  | "estimate"
  | "proposal";

interface TabDef {
  key: TabKey;
  label: string;
  available: boolean;
}

const TABS: TabDef[] = [
  { key: "overview", label: "Overview", available: true },
  { key: "bid_readiness", label: "Bid Readiness", available: true },
  { key: "documents", label: "Documents", available: true },
  { key: "intelligence", label: "Intelligence", available: true },
  { key: "coverage", label: "Coverage", available: true },
  { key: "addenda", label: "Addenda", available: false },
  { key: "activity", label: "Activity", available: false },
  { key: "estimate", label: "Estimate", available: false },
  { key: "proposal", label: "Proposal", available: false },
];

interface ProjectWorkspaceProps {
  project: any;
  projectFiles: any[];
  projectTrades: any[];
  submissions: any[];
  onDeleteProject: () => Promise<void>;
  onDownloadInternalFile: (filePath: string, fileName: string) => void;
  onDeleteInternalFile: (fileId: string, filePath: string) => void;
  onCopyBidLink: () => void;
  copied: boolean;
}

export function ProjectWorkspace({
  project,
  projectFiles,
  projectTrades,
  submissions,
  onDeleteProject,
  onDownloadInternalFile,
  onDeleteInternalFile,
  onCopyBidLink,
  copied,
}: ProjectWorkspaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) ?? "overview";

  const [pursuitStatus, setPursuitStatus] = useState<string>(
    project.pursuit_status ?? "reviewing",
  );
  const [savingPursuit, setSavingPursuit] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  const candidateId = project.source_opportunity_candidate_id as string | undefined;
  const { overview, documents, reportReady } = useOpportunityDossier(candidateId);

  const setTab = useCallback(
    (key: TabKey) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", key);
        return next;
      });
    },
    [setSearchParams],
  );

  const handlePursuitStatusChange = async (value: string) => {
    setSavingPursuit(true);
    const prev = pursuitStatus;
    setPursuitStatus(value);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          pursuit_status: value,
          pursuit_status_updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);
      if (error) throw error;
    } catch (e: any) {
      setPursuitStatus(prev);
      toast({ title: "Failed to update pursuit status", description: e?.message, variant: "destructive" });
    } finally {
      setSavingPursuit(false);
    }
  };

  const handleDeleteProject = async () => {
    setDeletingProject(true);
    try {
      await onDeleteProject();
    } finally {
      setDeletingProject(false);
    }
  };

  const bidRoomUrl = `${window.location.origin}/bid/${project.public_token}`;
  const ps = (pursuitStatus as PursuitStatus) in PURSUIT_STATUS_LABELS
    ? (pursuitStatus as PursuitStatus)
    : "reviewing";

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/projects")} className="mb-4 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Projects
        </Button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs">Project Workspace</Badge>
              <Badge
                variant="outline"
                className={`text-xs ${PURSUIT_STATUS_STYLES[ps]}`}
              >
                {PURSUIT_STATUS_LABELS[ps]}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              {project.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {[project.agency, project.county].filter(Boolean).join(" · ") || "Agency details unavailable"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Pursuit Status Selector */}
            <Select value={pursuitStatus} onValueChange={handlePursuitStatusChange} disabled={savingPursuit}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="pursuing">Pursuing</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
              </SelectContent>
            </Select>

            {candidateId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/opportunities/${candidateId}`)}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                View Intelligence
              </Button>
            )}
            {project.source_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(project.source_url, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Source
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate("/calendar")}>
              <CalendarDays className="h-4 w-4 mr-2" />
              Calendar
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={deletingProject}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the project from Projects, Calendar, and Bid HQ. The Intelligence Report remains available from Opportunities.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteProject} disabled={deletingProject}>
                    {deletingProject ? "Deleting..." : "Delete Project"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            } ${!tab.available ? "opacity-40 cursor-default" : ""}`}
            disabled={!tab.available}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab
          project={project}
          overview={overview}
          reportReady={reportReady}
          pursuitStatus={ps}
          candidateId={candidateId}
          onNavigate={navigate}
        />
      )}

      {activeTab === "bid_readiness" && (
        <BidReadinessTab projectId={project.id} />
      )}

      {activeTab === "documents" && (
        <DocumentsTab
          documents={documents}
          projectFiles={projectFiles}
          onDownload={onDownloadInternalFile}
          onDelete={onDeleteInternalFile}
        />
      )}

      {activeTab === "intelligence" && (
        <IntelligenceTab
          candidateId={candidateId}
          onNavigate={navigate}
        />
      )}

      {activeTab === "coverage" && (
        <CoverageTab
          project={project}
          projectTrades={projectTrades}
          submissions={submissions}
          bidRoomUrl={bidRoomUrl}
          copied={copied}
          onCopyBidLink={onCopyBidLink}
        />
      )}

      {(activeTab === "addenda" ||
        activeTab === "activity" ||
        activeTab === "estimate" ||
        activeTab === "proposal") && (
        <StubTab tab={activeTab} />
      )}
    </div>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────────

function OverviewTab({
  project,
  overview,
  reportReady,
  pursuitStatus,
  candidateId,
  onNavigate,
}: {
  project: any;
  overview: any;
  reportReady: boolean;
  pursuitStatus: PursuitStatus;
  candidateId: string | undefined;
  onNavigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="space-y-6">
      {/* Operational Context */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Pursuit Status</p>
            <p className="mt-1 font-medium text-foreground">{PURSUIT_STATUS_LABELS[pursuitStatus]}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Due</p>
            <p className="mt-1 font-medium text-foreground">
              {project.bid_due_at
                ? new Date(project.bid_due_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Agency</p>
            <p className="mt-1 font-medium text-foreground">{project.agency ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Added to Calendar</p>
            <p className="mt-1 font-medium text-foreground">
              {project.added_to_calendar_at
                ? new Date(project.added_to_calendar_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* OI Overview */}
      {overview ? (
        <OpportunityOverviewTab data={overview} />
      ) : (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          {reportReady === false ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Preparing Opportunity Intelligence…</p>
              {candidateId && (
                <Button variant="outline" size="sm" onClick={() => onNavigate(`/opportunities/${candidateId}`)}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  View Progress
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Opportunity Intelligence overview is not available.
              {candidateId && (
                <Button variant="link" size="sm" onClick={() => onNavigate(`/opportunities/${candidateId}`)}>
                  View opportunity
                </Button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Bid Readiness Tab ───────────────────────────────────────────────────────────

function BidReadinessTab({ projectId }: { projectId: string }) {
  return (
    <div className="max-w-2xl">
      <BidReadinessChecklist projectId={projectId} />
    </div>
  );
}

// ── Documents Tab ───────────────────────────────────────────────────────────────

function DocumentsTab({
  documents,
  projectFiles,
  onDownload,
  onDelete,
}: {
  documents: any[];
  projectFiles: any[];
  onDownload: (path: string, name: string) => void;
  onDelete: (id: string, path: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Source Documents
        </h2>
        <OpportunityDocumentsTab documents={documents} />
      </div>

      {projectFiles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Internal Documents
          </h2>
          <div className="bg-card border border-border rounded-lg p-6 space-y-2">
            {projectFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm"
              >
                <p className="font-medium text-foreground truncate">{file.file_name}</p>
                <Button variant="ghost" size="sm" onClick={() => onDownload(file.file_url, file.file_name)}>
                  Download
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Intelligence Tab ────────────────────────────────────────────────────────────

function IntelligenceTab({
  candidateId,
  onNavigate,
}: {
  candidateId: string | undefined;
  onNavigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4">
      <h2 className="text-base font-semibold text-foreground">Full Intelligence Report</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        The complete Opportunity Intelligence report — findings, citations, risk flags, and contract requirements — is available from the Opportunity dossier.
      </p>
      {candidateId ? (
        <Button
          className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
          onClick={() => onNavigate(`/opportunities/${candidateId}?tab=intelligence`)}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Open Full Intelligence Report
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">No linked opportunity found.</p>
      )}
    </div>
  );
}

// ── Coverage Tab ────────────────────────────────────────────────────────────────

function CoverageTab({
  project,
  projectTrades,
  submissions,
  bidRoomUrl,
  copied,
  onCopyBidLink,
}: {
  project: any;
  projectTrades: any[];
  submissions: any[];
  bidRoomUrl: string;
  copied: boolean;
  onCopyBidLink: () => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      {projectTrades.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-muted-foreground">No trades assigned. Trades management is available in the legacy workspace via Projects.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Trades</h2>
          <div className="space-y-2">
            {projectTrades.map((trade: any) => (
              <div key={trade.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <p className="text-sm font-medium">{trade.trade_types?.name ?? "Unknown"}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-4">
            <CallListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} />
            <BidListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} projectCounty={project.county} />
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Bid Room</h2>
        <p className="text-sm text-muted-foreground break-all mb-3">{bidRoomUrl}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCopyBidLink}>
            {copied ? "Copied" : "Copy Link"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(bidRoomUrl, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Bid Room
          </Button>
        </div>
        {submissions.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">{submissions.length} submission{submissions.length !== 1 ? "s" : ""} received.</p>
        )}
      </div>
    </div>
  );
}

// ── Stub Tab ────────────────────────────────────────────────────────────────────

const STUB_DESCRIPTIONS: Partial<Record<TabKey, string>> = {
  addenda: "Addenda monitoring, acknowledgment tracking, and deadline impact review.",
  activity: "Status changes, notes, and project timeline history.",
  estimate: "Bid item schedule, quantity review, and estimate preparation.",
  proposal: "Bid forms, submission instructions, and final package review.",
};

function StubTab({ tab }: { tab: TabKey }) {
  const label = TABS.find((t) => t.key === tab)?.label ?? tab;
  return (
    <div className="bg-card border border-border rounded-lg p-8 text-center">
      <h2 className="text-base font-semibold text-foreground mb-2">{label}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        {STUB_DESCRIPTIONS[tab] ?? `${label} workspace is planned for a future phase.`}
      </p>
    </div>
  );
}
