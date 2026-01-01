import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Globe, Search, X, Download, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { exportNetworkSubsToExcel } from "@/lib/excelExport";
import { getCategoryColor } from "@/lib/tradeTypes";

interface NetworkSubcontractor {
  id: string;
  company_name: string;
  license_number: string | null;
  license_status: string | null;
  phone: string | null;
  city: string | null;
  trades: { code: string; name: string; category: string | null }[];
}

export default function SubsNetwork() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<"text" | "trade">("text");
  const [textQuery, setTextQuery] = useState("");
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [results, setResults] = useState<NetworkSubcontractor[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Check auth on mount
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
      }
    };
    checkAuth();
  }, [navigate]);

  const handleSearch = async () => {
    // Validate inputs
    if (searchMode === "text" && !textQuery.trim()) {
      toast({
        title: "Enter search criteria",
        description: "Please enter a company name or license number to search.",
        variant: "destructive",
      });
      return;
    }

    if (searchMode === "trade" && selectedTradeIds.length === 0) {
      toast({
        title: "Select license types",
        description: "Please select at least one license type to search.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      let subIds: string[] = [];

      if (searchMode === "text") {
        // Text search: company name or license number
        const { data, error } = await supabase
          .from("subcontractors")
          .select("id, company_name, license_number, license_status, phone, city")
          .or(`company_name.ilike.%${textQuery}%,license_number.ilike.%${textQuery}%`)
          .limit(100);

        if (error) throw error;
        subIds = data?.map((s) => s.id) || [];

        // Attach trades to results
        if (data && data.length > 0) {
          const { data: tradeMappings, error: tradeError } = await supabase
            .from("sub_trade_mappings")
            .select("sub_id, trade_types(code, name, category)")
            .in("sub_id", subIds);

          if (tradeError) throw tradeError;

          const tradesMap = new Map<string, { code: string; name: string; category: string | null }[]>();
          tradeMappings?.forEach((tm) => {
            const existing = tradesMap.get(tm.sub_id) || [];
            if (tm.trade_types) {
              const tradeData = tm.trade_types as unknown as { code: string; name: string; category: string | null };
              existing.push({
                code: tradeData.code,
                name: tradeData.name,
                category: tradeData.category,
              });
            }
            tradesMap.set(tm.sub_id, existing);
          });

          const enrichedResults: NetworkSubcontractor[] = data.map((sub) => ({
            ...sub,
            trades: tradesMap.get(sub.id) || [],
          }));

          setResults(enrichedResults);
        } else {
          setResults([]);
        }
      } else {
        // Trade search: find subs with matching trades
        const { data: mappings, error: mappingError } = await supabase
          .from("sub_trade_mappings")
          .select("sub_id")
          .in("trade_type_id", selectedTradeIds);

        if (mappingError) throw mappingError;

        const uniqueSubIds = [...new Set(mappings?.map((m) => m.sub_id) || [])];

        if (uniqueSubIds.length === 0) {
          setResults([]);
        } else {
          const { data: subs, error: subError } = await supabase
            .from("subcontractors")
            .select("id, company_name, license_number, license_status, phone, city")
            .in("id", uniqueSubIds)
            .limit(100);

          if (subError) throw subError;

          // Attach trades
          if (subs && subs.length > 0) {
            const { data: tradeMappings, error: tradeError } = await supabase
              .from("sub_trade_mappings")
              .select("sub_id, trade_types(code, name, category)")
              .in("sub_id", subs.map((s) => s.id));

            if (tradeError) throw tradeError;

            const tradesMap = new Map<string, { code: string; name: string; category: string | null }[]>();
            tradeMappings?.forEach((tm) => {
              const existing = tradesMap.get(tm.sub_id) || [];
              if (tm.trade_types) {
                const tradeData = tm.trade_types as unknown as { code: string; name: string; category: string | null };
                existing.push({
                  code: tradeData.code,
                  name: tradeData.name,
                  category: tradeData.category,
                });
              }
              tradesMap.set(tm.sub_id, existing);
            });

            const enrichedResults: NetworkSubcontractor[] = subs.map((sub) => ({
              ...sub,
              trades: tradesMap.get(sub.id) || [],
            }));

            setResults(enrichedResults);
          } else {
            setResults([]);
          }
        }
      }
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: "Unable to search the network. Please try again.",
        variant: "destructive",
      });
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setTextQuery("");
    setSelectedTradeIds([]);
    setResults([]);
    setHasSearched(false);
  };

  const handleExport = () => {
    if (results.length === 0) {
      toast({
        title: "No data to export",
        description: "Search for subcontractors first, then export the results.",
        variant: "destructive",
      });
      return;
    }

    const exportData = results.map((sub) => ({
      company_name: sub.company_name,
      license_number: sub.license_number,
      license_status: sub.license_status,
      phone: sub.phone,
      city: sub.city,
      trades: sub.trades.map((t) => t.code).join(", "),
    }));

    exportNetworkSubsToExcel(exportData);

    toast({
      title: "Export complete",
      description: `Exported ${results.length} subcontractors to Excel.`,
    });
  };

  const handleModeChange = (value: "text" | "trade") => {
    setSearchMode(value);
    // Clear the other mode's input
    if (value === "text") {
      setSelectedTradeIds([]);
    } else {
      setTextQuery("");
    }
  };

  return (
    <Layout showSidebar>
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" />
            Subcontractor Network
          </h1>
          <p className="text-muted-foreground mt-1">
            Search the statewide network of 200k+ licensed subcontractors.
          </p>
        </div>

        {/* Search Controls */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <RadioGroup
            value={searchMode}
            onValueChange={(v) => handleModeChange(v as "text" | "trade")}
            className="space-y-4"
          >
            {/* Option A: Text Search */}
            <div className="flex items-start gap-3">
              <RadioGroupItem value="text" id="text-search" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="text-search" className="font-medium cursor-pointer">
                  Search by company name or CSLB #
                </Label>
                <Input
                  value={textQuery}
                  onChange={(e) => setTextQuery(e.target.value)}
                  placeholder="Enter company name or license number..."
                  className="mt-2"
                  disabled={searchMode !== "text"}
                  onKeyDown={(e) => e.key === "Enter" && searchMode === "text" && handleSearch()}
                />
              </div>
            </div>

            {/* Option B: Trade Search */}
            <div className="flex items-start gap-3">
              <RadioGroupItem value="trade" id="trade-search" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="trade-search" className="font-medium cursor-pointer">
                  Search by license types
                </Label>
                <div className="mt-2">
                  <TradeMultiSelect
                    selectedTradeIds={selectedTradeIds}
                    onSelectionChange={setSelectedTradeIds}
                    disabled={searchMode !== "trade"}
                    stateCode="CA"
                  />
                </div>
              </div>
            </div>
          </RadioGroup>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t border-border">
            <Button onClick={handleSearch} disabled={isLoading}>
              <Search className="h-4 w-4 mr-2" />
              {isLoading ? "Searching..." : "Search"}
            </Button>
            <Button variant="outline" onClick={handleClear}>
              <X className="h-4 w-4 mr-2" />
              Clear Search
            </Button>
            <Button variant="outline" onClick={handleExport} disabled={results.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export to Excel
            </Button>
          </div>
        </div>

        {/* Results Table */}
        {!hasSearched ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Search the network</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Use the search options above to find subcontractors by name, license number, or trade classification.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No subcontractors found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Try adjusting your search criteria or searching with different terms.
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-muted/50 border-b border-border">
              <span className="text-sm text-muted-foreground">
                {results.length} {results.length === 1 ? "result" : "results"} found
                {results.length === 100 && " (showing first 100)"}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>City</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div className="font-medium">{sub.company_name}</div>
                    </TableCell>
                    <TableCell>
                      {sub.license_number ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{sub.license_number}</span>
                          {sub.license_status && (
                            <Badge
                              variant={sub.license_status === "ACTIVE" ? "default" : "destructive"}
                              className="text-xs"
                            >
                              {sub.license_status}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {sub.trades.length > 0 ? (
                          sub.trades.slice(0, 3).map((trade, idx) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className={`text-xs ${getCategoryColor(trade.category)}`}
                            >
                              {trade.code}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                        {sub.trades.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{sub.trades.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.phone ? (
                        <span className="text-sm">{sub.phone}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {sub.city || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Layout>
  );
}
