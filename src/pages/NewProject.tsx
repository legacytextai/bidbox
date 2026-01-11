import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Loader2, CheckCircle2, Link as LinkIcon, FileEdit, ChevronDown, ChevronUp } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Progress } from "@/components/ui/progress";
import { z } from "zod";
import { validateProjectFile } from "@/lib/fileValidation";
import { TIMEZONE_OPTIONS, localDateTimeToUtc } from "@/lib/timezoneUtils";
import { FileDropzone } from "@/components/FileDropzone";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { CountySelect } from "@/components/CountySelect";
import { isValidCACounty } from "@/lib/californiaRegions";
import { isValidProjectUrl, detectPortalType, getPortalDisplayName } from "@/lib/platformDetection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  county: z.string().min(1, "Project county is required").refine(
    (val) => isValidCACounty(val),
    { message: "Please select a valid California county" }
  ),
  agency: z.string().max(200).optional(),
  bid_due_at: z.string().min(1, "Bid due date is required"),
  instructions: z.string().max(2000).optional(),
  timezone: z.string().min(1, "Time zone is required"),
});

const NewProject = () => {
  // Link-first state
  const [projectUrl, setProjectUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);

  // Manual entry form state
  const [formData, setFormData] = useState({
    name: "",
    county: "",
    agency: "",
    bid_due_at: "",
    job_walk_at: "",
    instructions: "",
    timezone: "America/Los_Angeles",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUpload, setCurrentUpload] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      } else {
        setUserId(session.user.id);
      }
    };
    checkAuth();
  }, [navigate]);

  // Handle Create from Link
  const handleCreateFromLink = async () => {
    if (!userId || !projectUrl.trim()) return;

    const url = projectUrl.trim();
    
    // Validate URL
    if (!isValidProjectUrl(url)) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid project URL (starting with http:// or https://)",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      const portalType = detectPortalType(url);
      const portalName = getPortalDisplayName(portalType);
      
      // Create project immediately with placeholder name
      const placeholderName = `Project from ${portalName}`;
      
      // Set a default bid due date 30 days from now (required field)
      const defaultBidDue = new Date();
      defaultBidDue.setDate(defaultBidDue.getDate() + 30);
      
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          gc_id: userId,
          name: placeholderName,
          source_url: url,
          portal_type: portalType,
          bid_due_at: defaultBidDue.toISOString(),
          timezone: "America/Los_Angeles",
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Upload any files that were added
      if (files.length > 0) {
        setIsUploading(true);
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setCurrentUpload(file.name);
          const filePath = `${userId}/${project.id}/${file.name}`;
          
          const { error: uploadError } = await supabase.storage
            .from("project-files")
            .upload(filePath, file);

          if (!uploadError) {
            await supabase.from("project_files").insert({
              project_id: project.id,
              file_name: file.name,
              file_url: filePath,
              file_size: file.size,
            });
          }
        }
        setCurrentUpload(null);
        setIsUploading(false);
      }

      // Copy bid link to clipboard
      const bidLink = `${window.location.origin}/bid/${project.public_token}`;
      await navigator.clipboard.writeText(bidLink);

      toast({
        title: "Project Created",
        description: "Analyzing project page... You'll see details shortly.",
      });

      // Navigate to project page immediately
      navigate(`/projects/${project.id}`);

      // Kick off crawl in background (fire and forget)
      supabase.functions.invoke("crawl-project", {
        body: { project_id: project.id, source_url: url },
      }).then(({ error }) => {
        if (error) {
          console.error("Crawl failed:", error);
        }
      });

    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChange = (newFiles: File[]) => {
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
    setFiles([...files, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  // Handle Manual Entry Submit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    setLoading(true);
    setIsUploading(true);

    try {
      const validation = projectSchema.parse(formData);

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          gc_id: userId,
          name: validation.name,
          county: validation.county,
          agency: validation.agency || null,
          bid_due_at: localDateTimeToUtc(validation.bid_due_at, validation.timezone),
          job_walk_at: formData.job_walk_at ? localDateTimeToUtc(formData.job_walk_at, validation.timezone) : null,
          instructions: validation.instructions || null,
          timezone: validation.timezone,
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Insert selected trades
      if (selectedTradeIds.length > 0) {
        const { error: tradesError } = await supabase
          .from("project_trades")
          .insert(
            selectedTradeIds.map((tradeTypeId) => ({
              project_id: project.id,
              trade_type_id: tradeTypeId,
            }))
          );
        if (tradesError) {
          console.error("Error saving trades:", tradesError);
        }
      }

      // Upload files with progress tracking
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrentUpload(file.name);
        const filePath = `${userId}/${project.id}/${file.name}`;
        
        const { error: uploadError } = await supabase.storage
          .from("project-files")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { error: fileError } = await supabase
          .from("project_files")
          .insert({
            project_id: project.id,
            file_name: file.name,
            file_url: filePath,
            file_size: file.size,
          });

        if (fileError) throw fileError;
      }
      setCurrentUpload(null);

      const bidLink = `${window.location.origin}/bid/${project.public_token}`;
      await navigator.clipboard.writeText(bidLink);

      toast({
        title: "Success",
        description: "Project Link Generated & Copied to Clipboard",
      });

      navigate(`/projects/${project.id}`);
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
          description: error.message || "Failed to create project",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setIsUploading(false);
      setCurrentUpload(null);
    }
  };

  const isDisabled = loading || isAnalyzing || isUploading;

  return (
    <Layout showSidebar={true}>
      <div className="p-8">
        <h1 className="text-3xl font-bold text-foreground mb-8">New Project</h1>

        <div className="max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT SIDE - Project Definition */}
          <div className="space-y-8">
            {/* Create from Link - Primary */}
            <div className="space-y-4 p-6 border border-border rounded-lg bg-card">
              <div className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">
                  Create from Link
                </h2>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Paste the public works project link below. BidBox will extract the project details, track changes, and keep it up to date.
              </p>

              <div className="space-y-3">
                <Input
                  placeholder="https://planetbids.com/portal/..."
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                  disabled={isDisabled}
                  className="text-base"
                />
                
                <Button
                  onClick={handleCreateFromLink}
                  disabled={isDisabled || !projectUrl.trim()}
                  size="lg"
                  className="w-full bg-[hsl(var(--bidbox-blue))] hover:bg-[hsl(var(--bidbox-blue))]/90 text-white font-bold"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing project...
                    </>
                  ) : (
                    "Create Project"
                  )}
                </Button>
              </div>
            </div>

            {/* Manual Entry - Collapsible Section */}
            <Collapsible open={showManualEntry} onOpenChange={setShowManualEntry}>
              <div className="p-6 border border-border rounded-lg bg-card">
                <CollapsibleTrigger className="w-full" disabled={isDisabled}>
                  <div className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <FileEdit className="h-5 w-5 text-primary" />
                      <h2 className="text-xl font-semibold text-foreground">
                        Manual Entry
                      </h2>
                    </div>
                    {showManualEntry ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground text-left mt-2">
                    Don't have a project link? Enter the project details manually below.
                  </p>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <form onSubmit={handleManualSubmit} className="space-y-6 mt-6 pt-6 border-t border-border">
                    <div className="space-y-2">
                      <Label htmlFor="name">Project Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        required
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="county">Project County *</Label>
                      <CountySelect
                        value={formData.county}
                        onChange={(value) =>
                          setFormData({ ...formData, county: value })
                        }
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="agency">Agency (optional)</Label>
                      <Input
                        id="agency"
                        value={formData.agency}
                        onChange={(e) =>
                          setFormData({ ...formData, agency: e.target.value })
                        }
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bid_due_at">Bid Due Date & Time *</Label>
                      <Input
                        id="bid_due_at"
                        type="datetime-local"
                        value={formData.bid_due_at}
                        onChange={(e) =>
                          setFormData({ ...formData, bid_due_at: e.target.value })
                        }
                        required
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="job_walk_at">Job Walk Date & Time (optional)</Label>
                      <Input
                        id="job_walk_at"
                        type="datetime-local"
                        value={formData.job_walk_at}
                        onChange={(e) =>
                          setFormData({ ...formData, job_walk_at: e.target.value })
                        }
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="timezone">Time Zone *</Label>
                      <Select
                        value={formData.timezone}
                        onValueChange={(value) =>
                          setFormData({ ...formData, timezone: value })
                        }
                        disabled={isDisabled}
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
                      <Label htmlFor="instructions">Instructions for Bidders</Label>
                      <Textarea
                        id="instructions"
                        value={formData.instructions}
                        onChange={(e) =>
                          setFormData({ ...formData, instructions: e.target.value })
                        }
                        rows={4}
                        placeholder="Enter any special instructions or requirements..."
                        disabled={isDisabled}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Required Trades (Optional)</Label>
                      <TradeMultiSelect
                        selectedTradeIds={selectedTradeIds}
                        onSelectionChange={setSelectedTradeIds}
                        disabled={isDisabled}
                        stateCode="CA"
                      />
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full bg-[hsl(var(--bidbox-blue))] hover:bg-[hsl(var(--bidbox-blue))]/90 text-white font-bold"
                      disabled={isDisabled}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        "Create Project"
                      )}
                    </Button>
                  </form>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>

          {/* RIGHT SIDE - Upload Documents (Optional) */}
          <div className="space-y-6">
            <div className="p-6 border border-border rounded-lg bg-card h-fit">
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Upload Documents
                <span className="text-sm font-normal text-muted-foreground ml-2">(Optional)</span>
              </h2>
              
              <p className="text-sm text-muted-foreground mb-4">
                Upload plans, specs, or bid documents now — or add them later.
              </p>

              <FileDropzone
                onFilesSelected={handleFileChange}
                accept=".pdf,.dwg,.xls,.xlsx"
                multiple={true}
                disabled={isDisabled}
                className={`border-2 border-dashed border-border rounded-lg p-8 text-center ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground">
                  {isUploading ? "Uploading files..." : "Click to upload or drag and drop"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  PDF, DWG, Excel up to 200MB
                </p>
              </FileDropzone>

              {files.length > 0 && (
                <div className="space-y-3 mt-4">
                  {files.map((file, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between p-3 bg-muted rounded">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {currentUpload === file.name ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                          )}
                          <span className="text-sm truncate">{file.name}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          disabled={isDisabled}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {currentUpload === file.name && (
                        <div className="px-3">
                          <Progress value={undefined} className="h-1" />
                          <p className="text-xs text-muted-foreground mt-1">Uploading...</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default NewProject;
