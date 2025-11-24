import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, Download, Trash2, Upload, CheckCircle2 } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import { format } from "date-fns";
import { validateProjectFile } from "@/lib/fileValidation";
import { getPublicBaseUrl } from "@/lib/getPublicBaseUrl";
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
}

const ProjectDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [copied, setCopied] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);

  useEffect(() => {
    loadProject();
  }, [id]);

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
    setLoading(false);
  };

  const copyBidLink = () => {
    const link = `${getPublicBaseUrl()}/bid/${project.public_token}`;
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

    for (const file of newFiles) {
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
      }
    }

    setNewFiles([]);
    loadProject();
    toast({
      title: "Success",
      description: "Files uploaded successfully",
    });
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
      <div className="flex h-screen w-full">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen w-full">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Project not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Button
            variant="ghost"
            onClick={() => navigate("/projects")}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Button>

          <h1 className="text-3xl font-bold text-foreground mb-8">
            {project.name}
          </h1>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={project.status}
                onValueChange={(value) => updateProject({ status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIVE">LIVE</SelectItem>
                  <SelectItem value="DEAD">DEAD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Bid Due Date</Label>
              <Input
                type="datetime-local"
                value={project.bid_due_at ? new Date(project.bid_due_at).toISOString().slice(0, 16) : ""}
                onChange={(e) =>
                  updateProject({ bid_due_at: new Date(e.target.value).toISOString() })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Responses</Label>
              <p className="text-2xl font-bold text-primary">{bids.length}</p>
            </div>

            <div className="space-y-2">
              <Label>Bid Box Link</Label>
              <Button
                variant="outline"
                onClick={copyBidLink}
                className="w-full"
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

              <div className="border-2 border-dashed border-border rounded-lg p-4">
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    e.target.files && setNewFiles(Array.from(e.target.files))
                  }
                  className="hidden"
                  id="new-file-upload"
                />
                <label
                  htmlFor="new-file-upload"
                  className="cursor-pointer flex items-center justify-center text-sm text-muted-foreground"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Add New Files
                </label>
                {newFiles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {newFiles.map((file, i) => (
                      <p key={i} className="text-sm">{file.name}</p>
                    ))}
                    <Button onClick={handleFileUpload} size="sm">
                      Upload Files
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-foreground">
                  Bids Received: {bids.length}
                </h2>
              </div>

              <div className="border border-border rounded-lg p-4 space-y-3">
                {bids.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No bids received yet
                  </p>
                ) : (
                  bids.map((bid) => (
                    <div
                      key={bid.id}
                      className="bg-muted rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-foreground">
                            {bid.bidder_name || "Unknown Bidder"}
                          </p>
                          {bid.company_name && (
                            <p className="text-sm text-muted-foreground">
                              {bid.company_name}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(bid.submitted_at), "MMM d, yyyy h:mm a")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadBid(bid.file_url, bid.file_name)}
                          className="flex-1"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          {bid.file_name}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
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
      </main>
    </div>
  );
};

export default ProjectDetail;
