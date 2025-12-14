import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateCallList } from "@/lib/callListGenerator";
import { exportCallListToExcel } from "@/lib/excelExport";

interface CallListButtonProps {
  projectId: string;
  projectName: string;
  gcId: string;
  hasSelectedTrades: boolean;
}

export function CallListButton({ 
  projectId, 
  projectName, 
  gcId,
  hasSelectedTrades 
}: CallListButtonProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = async () => {
    if (!hasSelectedTrades) {
      toast({
        title: "No trades selected",
        description: "Please select required trades for this project before generating a call list.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      const entries = await generateCallList(projectId, gcId);

      if (entries.length === 0) {
        toast({
          title: "No subcontractors found",
          description: "No matching subcontractors found for the selected trades. Add subs to your directory first.",
          variant: "destructive",
        });
        return;
      }

      exportCallListToExcel(entries, projectName);

      toast({
        title: "Call list exported",
        description: `Exported ${entries.length} subcontractors to Excel.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "Failed to generate call list. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={isGenerating}
      className="gap-2"
    >
      {isGenerating ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Phone className="h-4 w-4" />
      )}
      Export Call List
    </Button>
  );
}
