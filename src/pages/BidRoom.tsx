import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, CheckCircle2 } from "lucide-react";
import { CountdownTimer } from "@/components/CountdownTimer";
import { validateBidFile } from "@/lib/fileValidation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { format, differenceInDays, differenceInHours, differenceInMinutes, differenceInSeconds } from "date-fns";
import { z } from "zod";

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
        `${days.toString().padStart(2, "0")}:${hours
          .toString()
          .padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
          .toString()
          .padStart(2, "0")}`
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-primary mb-2">BB</h1>
        </div>

        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground mb-6">
            {project.name} Bid Box
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Project Information</h3>
              <div className="space-y-2 text-sm">
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
                    <Button
                      size="lg"
                      className="w-full lg:w-auto text-lg py-6 px-8"
                      disabled={isExpired}
                    >
                      {isExpired ? "Bid Closed" : "SUBMIT YOUR QUOTE"}
                    </Button>
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
                        className="w-full"
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

        <div className="mb-8">
          <CountdownTimer bidDueAt={project.bid_due_at} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Download Project Files</h3>
              <div className="space-y-2">
                {projectFiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No files available</p>
                ) : (
                  projectFiles.map((file) => (
                    <Button
                      key={file.id}
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => downloadFile(file.file_url, file.file_name)}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {file.file_name}
                    </Button>
                  ))
                )}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold text-foreground mb-4">Preview Project Files</h3>
              <div className="text-sm text-muted-foreground">
                Download files to preview
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BidRoom;
