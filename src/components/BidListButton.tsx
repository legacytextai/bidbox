import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateBidList } from "@/lib/bidListGenerator";
import { exportBidListToExcel } from "@/lib/excelExport";
import { isValidCACounty } from "@/lib/californiaRegions";

interface BidListButtonProps {
  projectId: string;
  projectName: string;
  gcId: string;
  hasSelectedTrades: boolean;
  projectCounty: string | null;
}

export function BidListButton({ 
  projectId, 
  projectName, 
  gcId,
  hasSelectedTrades,
  projectCounty,
}: BidListButtonProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = async () => {
    if (!hasSelectedTrades) {
      toast({
        title: "No trades selected",
        description: "Please select required trades for this project before generating a bid list.",
        variant: "destructive",
      });
      return;
    }

    // Validate county is set
    if (!projectCounty) {
      console.error('[BidList][Error] Missing county — export aborted');
      toast({
        title: "County required",
        description: "Please select a project county to generate a regional bid list.",
        variant: "destructive",
      });
      return;
    }

    // Validate county is valid
    if (!isValidCACounty(projectCounty)) {
      console.error('[BidList][Error] Invalid county — export aborted:', projectCounty);
      toast({
        title: "Invalid county",
        description: "Selected county is not supported for regional filtering.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);

    try {
      const result = await generateBidList(projectId, gcId, projectCounty);

      if (result.privateSubs.length === 0 && result.networkSubs.length === 0) {
        toast({
          title: "No subcontractors found",
          description: "No matching subcontractors found for the selected trades. Add subs to your directory first.",
          variant: "destructive",
        });
        return;
      }

      // Check if network subs is empty after filtering
      if (result.networkSubs.length === 0 && result.privateSubs.length > 0) {
        toast({
          title: "Limited results",
          description: "No network subcontractors found for selected trades in this region. Only your private subs are included.",
        });
      }

      exportBidListToExcel(result, projectName);

      toast({
        title: "Bid list exported",
        description: `Exported ${result.privateSubs.length} private + ${result.networkSubs.length} network subs to Excel.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "Failed to generate bid list. Please try again.",
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
        <FileSpreadsheet className="h-4 w-4" />
      )}
      Export Bid List
    </Button>
  );
}
