import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Loader2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Progress } from "@/components/ui/progress";
import { z } from "zod";
import { validateProjectFile } from "@/lib/fileValidation";

const projectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(200),
  location: z.string().max(200).optional(),
  agency: z.string().max(200).optional(),
  bid_due_at: z.string().min(1, "Bid due date is required"),
  instructions: z.string().max(2000).optional(),
});

const NewProject = () => {
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    agency: "",
    bid_due_at: "",
    instructions: "",
  });
  const [files, setFiles] = useState<File[]>([]);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      
      // Validate each file
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
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
          location: validation.location || null,
          agency: validation.agency || null,
          bid_due_at: validation.bid_due_at,
          instructions: validation.instructions || null,
        })
        .select()
        .single();

      if (projectError) throw projectError;

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

        toast({
          title: "File Uploaded",
          description: `${file.name} uploaded successfully`,
        });
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

  return (
    <Layout showSidebar={true}>
      <div className="p-8">
          <h1 className="text-3xl font-bold text-foreground mb-8">New Project</h1>

          <form onSubmit={handleSubmit} className="max-w-5xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Project Information
                </h2>

                <div className="space-y-2">
                  <Label htmlFor="name">Project Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location (optional)</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) =>
                      setFormData({ ...formData, location: e.target.value })
                    }
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
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instructions">Instructions for Bidders</Label>
                  <Textarea
                    id="instructions"
                    value={formData.instructions}
                    onChange={(e) =>
                      setFormData({ ...formData, instructions: e.target.value })
                    }
                    rows={6}
                    placeholder="Enter any special instructions or requirements..."
                  />
                </div>
              </div>

              <div className="space-y-6">
                <h2 className="text-xl font-semibold text-foreground mb-4">
                  Upload Project Files
                </h2>

                <div className={`border-2 border-dashed border-border rounded-lg p-8 text-center ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-upload"
                    accept=".pdf,.dwg,.xls,.xlsx"
                    disabled={isUploading}
                  />
                  <label
                    htmlFor="file-upload"
                    className={`flex flex-col items-center ${isUploading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {isUploading ? "Uploading files..." : "Click to upload or drag and drop"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      PDF, DWG, Excel up to 200MB
                    </p>
                  </label>
                </div>

                {files.length > 0 && (
                  <div className="space-y-3">
                    {files.map((file, index) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-muted rounded">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm truncate">{file.name}</span>
                            {currentUpload === file.name && (
                              <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                            disabled={isUploading}
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

            <div className="mt-8">
              <Button
                type="submit"
                size="lg"
                className="w-full lg:w-auto"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Project Bid Box Link"
                )}
              </Button>
            </div>
          </form>
        </div>
    </Layout>
  );
};

export default NewProject;
