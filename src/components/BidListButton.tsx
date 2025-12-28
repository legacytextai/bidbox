import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateBidList } from "@/lib/bidListGenerator";
import { exportBidListToExcel } from "@/lib/excelExport";

interface BidListButtonProps {
  projectId: string;
  projectName: string;
  gcId: string;
  hasSelectedTrades: boolean;
}

export function BidListButton({ 
  projectId, 
  projectName, 
  gcId,
  hasSelectedTrades 
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

    setIsGenerating(true);

    try {
      const result = await generateBidList(projectId, gcId);

      const totalCount = result.privateSubs.length + result.networkSubs.length;

      if (totalCount === 0) {
        toast({
          title: "No subcontractors found",
          description: "No matching subcontractors found for the selected trades.",
          variant: "destructive",
        });
        return;
      }

      exportBidListToExcel(result, projectName);

      toast({
        title: "Bid list exported",
        description: `Exported ${result.privateSubs.length} from My Subs, ${result.networkSubs.length} from Network.`,
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
      disabled={isGenerating || !hasSelectedTrades}
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
