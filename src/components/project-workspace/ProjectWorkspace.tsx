// Project Workspace — tabbed execution workspace for opportunities added to calendar.
//
// This file owns ONLY the shell:
//   - routing (tab query param)
//   - header (title, pursuit selector, actions)
//   - shared data loading (dossier hook)
//   - tab dispatch
//
// Each tab body lives under ./tabs/.

import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOpportunityDossier } from "@/hooks/useOpportunityDossier";
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
import { ArrowLeft, ExternalLink, CalendarDays, Trash2 } from "lucide-react";

import { OverviewTab } from "./tabs/OverviewTab";
import { BidReadinessTab } from "./tabs/BidReadinessTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { IntelligenceTab } from "./tabs/IntelligenceTab";
import { CoverageTab } from "./tabs/CoverageTab";
import { StubTab, type StubTabKey } from "./tabs/StubTab";

import type { PursuitStatus, WorkspaceProject, WorkspaceProjectFile, WorkspaceProjectTrade, WorkspaceProjectSubmission } from "@/lib/opportunityView";

const PURSUIT_STATUS_LABELS: Record<PursuitStatus, string> = {
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  passed: "Passed",
  submitted: "Submitted",
};

const PURSUIT_STATUS_STYLES: Record<PursuitStatus, string> = {
  reviewing: "bg-gray-500/10 text-gray-600",
  pursuing: "bg-green-500/10 text-green-600",
  passed: "bg-red-500/10 text-red-600",
  submitted: "bg-blue-500/10 text-blue-600",
};

type TabKey =
  | "overview"
  | "bid_readiness"
  | "documents"
  | "intelligence"
  | "coverage"
  | StubTabKey;

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

export interface ProjectWorkspaceProps {
  project: WorkspaceProject;
  projectFiles: WorkspaceProjectFile[];
  projectTrades: WorkspaceProjectTrade[];
  submissions: WorkspaceProjectSubmission[];
  onDeleteProject: () => Promise<void>;
  onDownloadInternalFile: (filePath: string, fileName: string) => void;
  onDeleteInternalFile: (fileId: string, filePath: string) => void;
  onCopyBidLink: () => void;
  editingTrades: boolean;
  editedTradeIds: string[];
  savingTrades: boolean;
  onEditingTradesChange: (open: boolean) => void;
  onEditedTradeIdsChange: (ids: string[]) => void;
  onSaveTrades: () => void;
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
  editingTrades,
  editedTradeIds,
  savingTrades,
  onEditingTradesChange,
  onEditedTradeIdsChange,
  onSaveTrades,
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

  const candidateId = project.source_opportunity_candidate_id ?? undefined;
  const {
    overview,
    documents,
    reportReady,
    candidate,
    report,
    findings,
    citationsByFinding,
    activeTask,
    linkedProject,
    analysisWorkActive,
    reload,
  } = useOpportunityDossier(candidateId);

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
        } as never)
        .eq("id", project.id);
      if (error) throw error;
    } catch (e: unknown) {
      setPursuitStatus(prev);
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to update pursuit status", description: message, variant: "destructive" });
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
  const ps: PursuitStatus =
    (pursuitStatus as PursuitStatus) in PURSUIT_STATUS_LABELS
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
              <Badge variant="outline" className={`text-xs ${PURSUIT_STATUS_STYLES[ps]}`}>
                {PURSUIT_STATUS_LABELS[ps]}
              </Badge>
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">{project.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {[project.agency, project.county].filter(Boolean).join(" · ") || "Agency details unavailable"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={pursuitStatus} onValueChange={handlePursuitStatusChange} disabled={savingPursuit}>
              <SelectTrigger className={`w-36 h-9 text-sm ${PURSUIT_STATUS_STYLES[ps]}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["reviewing", "pursuing", "passed", "submitted"] as PursuitStatus[]).map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    className={status === ps ? PURSUIT_STATUS_STYLES[status] : undefined}
                  >
                    {PURSUIT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {project.source_url && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(project.source_url!, "_blank", "noopener,noreferrer")}
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={deletingProject}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the project from Projects, Calendar, and Bid HQ. The Intelligence Report
                    remains available from Opportunities.
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
        <BidReadinessTab projectId={project.id} findings={findings} />
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
          candidate={candidate}
          report={report}
          findings={findings}
          citationsByFinding={citationsByFinding}
          documents={documents}
          activeTask={activeTask}
          linkedProject={linkedProject}
          reportReady={reportReady}
          analysisWorkActive={analysisWorkActive}
          reload={reload}
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
          editingTrades={editingTrades}
          editedTradeIds={editedTradeIds}
          savingTrades={savingTrades}
          onEditingTradesChange={onEditingTradesChange}
          onEditedTradeIdsChange={onEditedTradeIdsChange}
          onSaveTrades={onSaveTrades}
        />
      )}

      {(activeTab === "addenda" ||
        activeTab === "activity" ||
        activeTab === "estimate" ||
        activeTab === "proposal") && <StubTab tab={activeTab} />}
    </div>
  );
}
