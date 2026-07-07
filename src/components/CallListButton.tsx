import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateCallList } from "@/lib/callListGenerator";
import type { CallListDiagnostics } from "@/lib/callListGenerator";
import { exportCallListToExcel } from "@/lib/excelExport";

interface CallListButtonProps {
  projectId: string;
  projectName: string;
  gcId: string;
  hasSelectedTrades: boolean;
}

function getEmptyCallListToast(diagnostics: CallListDiagnostics) {
  if (diagnostics.projectTradeQueryFailed) {
    return {
      title: "Could not read project trades",
      description: "The call list could not check this project's required trades. Please try again.",
    };
  }
  if (diagnostics.privateQueryFailed && diagnostics.networkQueryFailed) {
    return {
      title: "Subcontractor lookup failed",
      description: "BidBox could not read either your private subs or the network subs. Please try again.",
    };
  }
  if (diagnostics.privateQueryFailed) {
    return {
      title: "Private subs lookup failed",
      description: "BidBox could not read your private subcontractor directory. Network matches may be incomplete.",
    };
  }
  if (diagnostics.networkQueryFailed) {
    return {
      title: "Network subs lookup failed",
      description: "BidBox could not read network subcontractors. Private directory matches may be incomplete.",
    };
  }
  if (diagnostics.missingTradeMappings) {
    return {
      title: "No trade mappings found",
      description: "The selected trades do not have subcontractor trade mappings yet, so BidBox cannot match subs automatically.",
    };
  }
  return {
    title: "No matching subcontractors",
    description: "No private or network subcontractors matched the selected trades.",
  };
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
      const result = await generateCallList(projectId, gcId);

      if (result.entries.length === 0) {
        const emptyToast = getEmptyCallListToast(result.diagnostics);
        toast({
          title: emptyToast.title,
          description: emptyToast.description,
          variant: "destructive",
        });
        return;
      }

      exportCallListToExcel(result.entries, projectName);

      toast({
        title: "Call list exported",
        description: `Exported ${result.entries.length} subcontractors to Excel.`,
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
