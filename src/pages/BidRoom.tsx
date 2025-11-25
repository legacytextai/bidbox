import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, CheckCircle2, Plus, FileText, FileSpreadsheet, File as FileIcon } from "lucide-react";
import { validateBidFile } from "@/lib/fileValidation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { z } from "zod";
import FilePreview from "@/components/FilePreview";

const bidSchema = z.object({
  bidder_name: z.string().max(100).optional(),
  company_name: z.string().max(100).optional(),
  email: z.string().email("Invalid email").max(255).optional().or(z.literal("")),
  bid_item: z.string().max(200).optional(),
});

interface ProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

const BidRoom = () => {
  const { token } = useParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [countdown, setCountdown] = useState("");
  const [isExpired, setIsExpired] = useState(false);
  const [bidFile, setBidFile] = useState<File | null>(null);
  const [bidData, setBidData] = useState({
    bidder_name: "",
    company_name: "",
    email: "",
    bid_item: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadProject();
  }, [token]);

  useEffect(() => {
    if (!project) return;

    const interval = setInterval(() => {
      const now = new Date();
      const dueDate = new Date(project.bid_due_at);
      const diff = dueDate.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("EXPIRED");
        setIsExpired(true);
        clearInterval(interval);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(
        `${days.toString().padStart(2, "0")}d:${hours
          .toString()
          .padStart(2, "0")}h:${minutes.toString().padStart(2, "0")}m:${seconds
          .toString()
          .padStart(2, "0")}s`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [project]);

  const loadProject = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('get-public-project', {
        body: { token }
      });

      if (error || !data || !data.project) {
        toast({
          title: "Error",
          description: "Project not found",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      setProject(data.project);
      setProjectFiles(data.files || []);
      setLoading(false);
    } catch (error) {
      console.error('Error loading project:', error);
      toast({
        title: "Error",
        description: "Failed to load project",
        variant: "destructive",
      });
      setLoading(false);
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

  const handleSubmitBid = async () => {
    if (!bidFile) {
      toast({
        title: "Error",
        description: "Please select a file to upload",
        variant: "destructive",
      });
      return;
    }

    // Validate file
    const validation = validateBidFile(bidFile);
    if (!validation.valid) {
      toast({
        title: "Invalid File",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      const validation = bidSchema.parse(bidData);

      const filePath = `${project.id}/${Date.now()}_${bidFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("bid-submissions")
        .upload(filePath, bidFile);

      if (uploadError) throw uploadError;

      const { error: bidError } = await supabase.from("bids").insert({
        project_id: project.id,
        file_url: filePath,
        file_name: bidFile.name,
        bidder_name: validation.bidder_name || null,
        company_name: validation.company_name || null,
        email: validation.email || null,
        bid_item: validation.bid_item || null,
      });

      if (bidError) throw bidError;

      setSubmitted(true);
      setDialogOpen(false);
      toast({
        title: "Success!",
        description: "Your bid has been submitted successfully",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to submit bid",
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf':
        return <FileText className="h-5 w-5 text-red-500" />;
      case 'xlsx':
      case 'xls':
      case 'csv':
        return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
      default:
        return <FileIcon className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="mb-8">
          <Link to="/" className="inline-block">
            <h1 className="text-2xl font-bold text-[hsl(var(--bidbox-blue))] mb-2 cursor-pointer hover:opacity-80 transition-opacity">
              BB
            </h1>
          </Link>
        </div>

        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-6">
            {project.name} Bid Box
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Project Information</h3>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">GC:</span>{" "}
                  {project.gc_company_name ? (
                    <span className="text-foreground">{project.gc_company_name}</span>
                  ) : (
                    <span className="text-red-500 font-medium">Add GC Info Here</span>
                  )}
                </p>
                <p><span className="text-muted-foreground">Location:</span> {project.location}</p>
                <p><span className="text-muted-foreground">Agency:</span> {project.agency}</p>
                <p><span className="text-muted-foreground">Bid Due:</span> {format(new Date(project.bid_due_at), "MMMM d, yyyy 'at' h:mm a")}</p>
                {project.instructions && (
                  <div className="mt-4">
                    <p className="text-muted-foreground mb-2">Instructions:</p>
                    <p className="text-foreground whitespace-pre-wrap">{project.instructions}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-center">
              {submitted ? (
                <div className="text-center">
                  <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-semibold text-foreground mb-2">Bid Submitted!</p>
                  <p className="text-sm text-muted-foreground">
                    Thank you for your submission
                  </p>
                </div>
              ) : (
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <DialogTrigger asChild>
                    <div className="w-full lg:w-auto flex flex-col gap-3">
                      <Button
                        className="w-full bg-[#F97316] hover:bg-[#F97316]/90 text-white font-semibold py-6 text-base"
                        disabled={isExpired}
                      >
                        SUBMIT YOUR QUOTE
                      </Button>
                      <div 
                        className={`w-full min-h-[180px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                          isExpired 
                            ? "border-muted bg-muted/20 cursor-not-allowed opacity-50" 
                            : "border-[#F97316] bg-[#F97316]/5 hover:bg-[#F97316]/10 hover:border-[hsl(var(--bidbox-blue))]"
                        }`}
                      >
                        <Plus className="h-12 w-12 text-[#F97316]" strokeWidth={2.5} />
                        <p className="text-sm text-muted-foreground">
                          {isExpired ? "Bid Closed" : "Click or Drag & Drop Files"}
                        </p>
                      </div>
                    </div>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Submit Your Quote</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="file">Upload Your Bid File *</Label>
                        <div className="border-2 border-dashed border-border rounded-lg p-4">
                          <input
                            type="file"
                            id="file"
                            onChange={(e) => e.target.files && setBidFile(e.target.files[0])}
                            className="hidden"
                          />
                          <label htmlFor="file" className="cursor-pointer flex flex-col items-center">
                            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                            {bidFile ? (
                              <p className="text-sm text-foreground">{bidFile.name}</p>
                            ) : (
                              <p className="text-sm text-muted-foreground">Click to upload</p>
                            )}
                          </label>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="name">Name (Optional)</Label>
                        <Input
                          id="name"
                          value={bidData.bidder_name}
                          onChange={(e) =>
                            setBidData({ ...bidData, bidder_name: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="company">Company (Optional)</Label>
                        <Input
                          id="company"
                          value={bidData.company_name}
                          onChange={(e) =>
                            setBidData({ ...bidData, company_name: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email">Email (Optional)</Label>
                        <Input
                          id="email"
                          type="email"
                          value={bidData.email}
                          onChange={(e) =>
                            setBidData({ ...bidData, email: e.target.value })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="item">Bid Item/Division (Optional)</Label>
                        <Input
                          id="item"
                          value={bidData.bid_item}
                          onChange={(e) =>
                            setBidData({ ...bidData, bid_item: e.target.value })
                          }
                        />
                      </div>

                      <Button
                        onClick={handleSubmitBid}
                        className="w-full bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                        disabled={submitting}
                      >
                        {submitting ? "Submitting..." : "Submit Bid"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>

          <div className="text-center mb-8 py-6 border-y border-border">
            <p className="text-xl md:text-2xl font-bold uppercase mb-4 text-foreground">
              BID DUE IN:
            </p>
            <p className={`text-4xl md:text-6xl font-bold ${
              isExpired ? "text-destructive" : "text-primary"
            }`}>
              {countdown}
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Download Project Files</h3>
              {projectFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files available</p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {projectFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 px-4 py-3 bg-muted rounded-full border border-border hover:bg-muted/80 transition-colors cursor-pointer flex-shrink-0"
                      onClick={() => downloadFile(file.file_url, file.file_name)}
                    >
                      {getFileIcon(file.file_name)}
                      <span className="text-sm font-medium text-foreground whitespace-nowrap">
                        {file.file_name}
                      </span>
                      <Download className="h-4 w-4 text-[hsl(var(--bidbox-blue))]" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Preview Project Files</h3>
              <FilePreview files={projectFiles} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BidRoom;
