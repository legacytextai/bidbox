import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, Download, Trash2, Upload, CheckCircle2, Loader2, Pencil } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { validateProjectFile } from "@/lib/fileValidation";
import { TIMEZONE_OPTIONS, localDateTimeToUtc, utcToLocalDateTime } from "@/lib/timezoneUtils";
import { FileDropzone } from "@/components/FileDropzone";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { TradeType, getCategoryColor } from "@/lib/tradeTypes";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

interface Bid {
  id: string;
  submitted_at: string;
  file_name: string;
  file_url: string;
  bidder_name?: string;
  company_name?: string;
  email?: string;
  bid_item?: string;
  submission_id?: string;
}

interface Submission {
  submission_id: string;
  submitted_at: string;
  bidder_name?: string;
  company_name?: string;
  email?: string;
  bid_item?: string;
  files: { file_name: string; file_url: string }[];
}

interface ProjectTrade {
  id: string;
  trade_type_id: string;
  trade_types: TradeType;
}

const ProjectDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [copied, setCopied] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [currentUpload, setCurrentUpload] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Trade-related state
  const [projectTrades, setProjectTrades] = useState<ProjectTrade[]>([]);
  const [editingTrades, setEditingTrades] = useState(false);
  const [editedTradeIds, setEditedTradeIds] = useState<string[]>([]);
  const [savingTrades, setSavingTrades] = useState(false);
  
  // Editable field states
  const [editedName, setEditedName] = useState("");
  const [editedLocation, setEditedLocation] = useState("");
  const [editedAgency, setEditedAgency] = useState("");
  const [editedInstructions, setEditedInstructions] = useState("");
  const [editedBidDueAt, setEditedBidDueAt] = useState("");
  const [editedTimezone, setEditedTimezone] = useState("America/Los_Angeles");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  // Track changes to editable fields
  useEffect(() => {
    if (project) {
      const projectTimezone = project.timezone || "America/Los_Angeles";
      const originalBidDue = project.bid_due_at ? utcToLocalDateTime(project.bid_due_at, projectTimezone) : "";
      const changed = 
        editedName !== project.name ||
        editedLocation !== (project.location || "") ||
        editedAgency !== (project.agency || "") ||
        editedInstructions !== (project.instructions || "") ||
        editedBidDueAt !== originalBidDue ||
        editedTimezone !== projectTimezone;
      setHasChanges(changed);
    }
  }, [editedName, editedLocation, editedAgency, editedInstructions, editedBidDueAt, editedTimezone, project]);

  const loadProject = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (projectError) {
      toast({
        title: "Error",
        description: "Failed to load project",
        variant: "destructive",
      });
      return;
    }

    setProject(projectData);
    
    // Initialize editable fields
    const projectTimezone = projectData.timezone || "America/Los_Angeles";
    setEditedName(projectData.name);
    setEditedLocation(projectData.location || "");
    setEditedAgency(projectData.agency || "");
    setEditedInstructions(projectData.instructions || "");
    setEditedBidDueAt(projectData.bid_due_at ? utcToLocalDateTime(projectData.bid_due_at, projectTimezone) : "");
    setEditedTimezone(projectTimezone);

    const { data: filesData } = await supabase
      .from("project_files")
      .select("*")
      .eq("project_id", id);

    setProjectFiles(filesData || []);

    const { data: bidsData } = await supabase
      .from("bids")
      .select("*")
      .eq("project_id", id)
      .order("submitted_at", { ascending: false });

    setBids(bidsData || []);
    
    // Group bids by submission_id
    const groupedSubmissions = (bidsData || []).reduce((acc: Record<string, Submission>, bid: Bid) => {
      const key = bid.submission_id || bid.id; // Fallback for legacy bids
      if (!acc[key]) {
        acc[key] = {
          submission_id: key,
          submitted_at: bid.submitted_at,
          bidder_name: bid.bidder_name,
          company_name: bid.company_name,
          email: bid.email,
          bid_item: bid.bid_item,
          files: []
        };
      }
      acc[key].files.push({ file_name: bid.file_name, file_url: bid.file_url });
      return acc;
    }, {});

    setSubmissions(Object.values(groupedSubmissions));

    // Load project trades
    const { data: tradesData } = await supabase
      .from("project_trades")
      .select(`
        id,
        trade_type_id,
        trade_types (id, code, name, category, state_code, source, is_default)
      `)
      .eq("project_id", id);

    if (tradesData) {
      setProjectTrades(tradesData as unknown as ProjectTrade[]);
      setEditedTradeIds(tradesData.map((t: any) => t.trade_type_id));
    }

    setLoading(false);
  };

  const copyBidLink = () => {
    const link = `${window.location.origin}/bid/${project.public_token}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied!",
      description: "Bid link copied to clipboard",
    });
  };

  const updateProject = async (updates: any) => {
    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update project",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Project updated",
      });
      loadProject();
    }
  };

  const saveAllChanges = async () => {
    if (!editedName.trim()) {
      toast({
        title: "Error",
        description: "Project name cannot be empty",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    
    const updates = {
      name: editedName,
      location: editedLocation || null,
      agency: editedAgency || null,
      instructions: editedInstructions || null,
      bid_due_at: editedBidDueAt ? localDateTimeToUtc(editedBidDueAt, editedTimezone) : project.bid_due_at,
      timezone: editedTimezone,
    };

    const { error } = await supabase
      .from("projects")
      .update(updates)
      .eq("id", id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Project updated successfully",
      });
      setHasChanges(false);
      loadProject();
    }
    
    setIsSaving(false);
  };

  const saveTrades = async () => {
    setSavingTrades(true);
    
    // Delete existing trades
    const { error: deleteError } = await supabase
      .from("project_trades")
      .delete()
      .eq("project_id", id);

    if (deleteError) {
      toast({
        title: "Error",
        description: "Failed to update trades",
        variant: "destructive",
      });
      setSavingTrades(false);
      return;
    }

    // Insert new trades
    if (editedTradeIds.length > 0) {
      const { error: insertError } = await supabase
        .from("project_trades")
        .insert(
          editedTradeIds.map((tradeTypeId) => ({
            project_id: id,
            trade_type_id: tradeTypeId,
          }))
        );

      if (insertError) {
        toast({
          title: "Error",
          description: "Failed to save trades",
          variant: "destructive",
        });
        setSavingTrades(false);
        return;
      }
    }

    toast({
      title: "Success",
      description: "Trades updated successfully",
    });
    
    setEditingTrades(false);
    setSavingTrades(false);
    loadProject();
  };

  const handleFileUpload = async () => {
    if (newFiles.length === 0) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // Validate all files first
    for (const file of newFiles) {
      const validation = validateProjectFile(file);
      if (!validation.valid) {
        toast({
          title: "Invalid File",
          description: `${file.name}: ${validation.error}`,
          variant: "destructive",
        });
        return;
      }
    }

    setIsUploading(true);

    for (const file of newFiles) {
      setCurrentUpload(file.name);
      const filePath = `${session.user.id}/${id}/${file.name}`;
      
      const { error: uploadError } = await supabase.storage
        .from("project-files")
        .upload(filePath, file);

      if (uploadError) {
        toast({
          title: "Error",
          description: `Failed to upload ${file.name}`,
          variant: "destructive",
        });
        setIsUploading(false);
        setCurrentUpload(null);
        continue;
      }

      const { error: dbError } = await supabase
        .from("project_files")
        .insert({
          project_id: id,
          file_name: file.name,
          file_url: filePath,
          file_size: file.size,
        });

      if (dbError) {
        toast({
          title: "Error",
          description: `Failed to save ${file.name}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "File Uploaded",
          description: `${file.name} uploaded successfully`,
        });
      }
    }

    setNewFiles([]);
    setIsUploading(false);
    setCurrentUpload(null);
    loadProject();
  };

  const deleteFile = async (fileId: string, filePath: string) => {
    const { error: storageError } = await supabase.storage
      .from("project-files")
      .remove([filePath]);

    if (storageError) {
      toast({
        title: "Error",
        description: "Failed to delete file",
        variant: "destructive",
      });
      return;
    }

    const { error: dbError } = await supabase
      .from("project_files")
      .delete()
      .eq("id", fileId);

    if (dbError) {
      toast({
        title: "Error",
        description: "Failed to delete file record",
        variant: "destructive",
      });
    } else {
      loadProject();
      toast({
        title: "Success",
        description: "File deleted",
      });
    }
  };

  const downloadFile = async (filePath: string, fileName: string) => {
    const { data, error } = await supabase.storage
      .from("project-files")
      .download(filePath);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to download file",
        variant: "destructive",
      });
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadBid = async (filePath: string, fileName: string) => {
    const { data, error } = await supabase.storage
      .from("bid-submissions")
      .download(filePath);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to download bid",
        variant: "destructive",
      });
      return;
    }

    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteSubmission = async (submissionId: string) => {
    // Get all bids for this submission to find file paths
    const bidsToDelete = bids.filter(bid => (bid.submission_id || bid.id) === submissionId);
    
    // Delete files from storage
    for (const bid of bidsToDelete) {
      const { error: storageError } = await supabase.storage
        .from("bid-submissions")
        .remove([bid.file_url]);
      
      if (storageError) {
        console.error("Failed to delete file:", storageError);
      }
    }

    // Delete bid records from database
    const { error: dbError } = await supabase
      .from("bids")
      .delete()
      .eq("submission_id", submissionId);

    if (dbError) {
      toast({
        title: "Error",
        description: "Failed to delete submission",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Submission deleted",
      });
      loadProject();
    }
  };

  const deleteProject = async () => {
    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete project",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Project deleted",
      });
      navigate("/projects");
    }
  };

  if (loading) {
    return (
      <Layout showSidebar={true}>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </Layout>
    );
  }

  if (!project) {
    return (
      <Layout showSidebar={true}>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Project not found</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showSidebar={true}>
      <div className="p-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/projects")}
            className="mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Button>

          {/* Editable Project Information */}
          <div className="space-y-2 mb-3">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                className="text-2xl font-bold h-auto py-2"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={editedLocation}
                  onChange={(e) => setEditedLocation(e.target.value)}
                  placeholder="Enter location"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agency">Agency</Label>
                <Input
                  id="agency"
                  value={editedAgency}
                  onChange={(e) => setEditedAgency(e.target.value)}
                  placeholder="Enter agency"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={project.status}
                onValueChange={(value) => updateProject({ status: value })}
              >
                <SelectTrigger className={project.status === "LIVE" ? "text-green-600 font-semibold" : "text-muted-foreground"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIVE" className="text-green-600 font-semibold">LIVE</SelectItem>
                  <SelectItem value="DEAD" className="text-muted-foreground">DEAD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Bid Due Date</Label>
              <Input
                type="datetime-local"
                value={editedBidDueAt}
                onChange={(e) => setEditedBidDueAt(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Time Zone</Label>
              <Select
                value={editedTimezone}
                onValueChange={(value) => setEditedTimezone(value)}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Responses</Label>
              <p className="text-2xl font-bold text-primary">{submissions.length}</p>
            </div>
          </div>

          {/* Instructions Section */}
          <div className="space-y-2 mb-3">
            <Label htmlFor="instructions">Instructions for Bidders</Label>
            <Textarea
              id="instructions"
              value={editedInstructions}
              onChange={(e) => setEditedInstructions(e.target.value)}
              placeholder="Enter any special instructions, requirements, or notes for bidders"
              className="min-h-[100px]"
            />
          </div>

          {/* Required Trades Section */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <Label>Required Trades</Label>
              <Dialog open={editingTrades} onOpenChange={setEditingTrades}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-2">
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Edit Required Trades</DialogTitle>
                    <DialogDescription>
                      Select the trades required for this project.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <TradeMultiSelect
                      selectedTradeIds={editedTradeIds}
                      onSelectionChange={setEditedTradeIds}
                      stateCode="CA"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditedTradeIds(projectTrades.map(t => t.trade_type_id));
                        setEditingTrades(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button onClick={saveTrades} disabled={savingTrades}>
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
            </div>
            {projectTrades.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {projectTrades.map((pt) => (
                  <Badge
                    key={pt.id}
                    variant="outline"
                    className={cn(
                      "px-2 py-1 text-xs font-medium border",
                      getCategoryColor(pt.trade_types?.category)
                    )}
                  >
                    <span className="font-mono mr-1">{pt.trade_types?.code}</span>
                    {pt.trade_types?.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No trades selected</p>
            )}
          </div>

          {/* Bid Box Link and Save Changes Section */}
          <div className="flex justify-between items-start mb-4 gap-4">
            <div className="space-y-2">
              <Label>Bid Box Link</Label>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyBidLink}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Link
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="opacity-0">Actions</Label>
              <div className="flex flex-col gap-2 items-start">
                <Button 
                  onClick={saveAllChanges} 
                  disabled={!hasChanges || isSaving}
                  size="lg"
                  className={hasChanges ? "bg-bidbox-blue hover:bg-bidbox-blue/90 text-white" : ""}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
                {hasChanges && (
                  <p className="text-sm text-muted-foreground">
                    You have unsaved changes
                  </p>
                )}
              </div>
            </div>
          </div>


          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">
                Project Documents
              </h2>

              <div className="border border-border rounded-lg p-4 space-y-2">
                {projectFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-3 bg-muted rounded"
                  >
                    <span className="text-sm truncate">{file.file_name}</span>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadFile(file.file_url, file.file_name)}
                      >
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
                              Are you sure you want to delete this file? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteFile(file.id, file.file_url)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>

              <FileDropzone
                onFilesSelected={(files) => setNewFiles(files)}
                accept=".pdf,.dwg,.xls,.xlsx"
                multiple={true}
                disabled={isUploading}
                className={`border-2 border-dashed border-border rounded-lg p-4 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Upload className="h-4 w-4 mr-2 inline" />
                <span className="text-sm text-muted-foreground">
                  {isUploading ? "Uploading..." : "Click to upload or drag and drop"}
                </span>
              </FileDropzone>
              {newFiles.length > 0 && (
                <div className="mt-4 space-y-3">
                  {newFiles.map((file, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm">{file.name}</p>
                        {currentUpload === file.name && (
                          <span className="text-xs text-muted-foreground">(Uploading...)</span>
                        )}
                      </div>
                      {currentUpload === file.name && (
                        <Progress value={undefined} className="h-1" />
                      )}
                    </div>
                  ))}
                  <Button onClick={handleFileUpload} size="sm" disabled={isUploading}>
                    Upload Files
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-foreground">
                  Bids Received: {submissions.length}
                </h2>
              </div>

              <div className="border border-border rounded-lg p-4 space-y-3">
                {submissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No bids received yet
                  </p>
                ) : (
                  submissions.map((submission) => (
                    <div
                      key={submission.submission_id}
                      className="bg-muted rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-foreground">
                            {submission.bidder_name || "Unknown Bidder"}
                          </p>
                          {submission.company_name && (
                            <p className="text-sm text-muted-foreground">
                              {submission.company_name}
                            </p>
                          )}
                          {submission.email && (
                            <p className="text-sm text-muted-foreground">
                              {submission.email}
                            </p>
                          )}
                          {submission.bid_item && (
                            <p className="text-sm text-muted-foreground">
                              Division: {submission.bid_item}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(submission.submitted_at), "MMM d, yyyy h:mm a")}
                          </p>
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
                                Are you sure you want to delete this bid submission? This will delete all files associated with it. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteSubmission(submission.submission_id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      
                      <div className="space-y-2">
                        {submission.files.map((file, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            onClick={() => downloadBid(file.file_url, file.file_name)}
                            className="w-full justify-start"
                          >
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
          </div>

          <div className="mt-8 flex justify-end items-center">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Project</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this project? This will delete all
                    files and bids associated with it. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteProject}>
                    Delete Project
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </Layout>
    );
  };
  
  export default ProjectDetail;
