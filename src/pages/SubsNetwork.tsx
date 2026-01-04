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
import { Globe, Search, X, Download, Building2, ChevronLeft, ChevronRight } from "lucide-react";
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

const PAGE_SIZE = 50;

export default function SubsNetwork() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<"text" | "trade">("text");
  const [textQuery, setTextQuery] = useState("");
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [results, setResults] = useState<NetworkSubcontractor[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

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

  // Fetch a page of results
  const fetchPage = async (page: number) => {
    const offset = (page - 1) * PAGE_SIZE;
    
    try {
      if (searchMode === "text") {
        // Text search with pagination
        const { data, error } = await supabase
          .from("subcontractors")
          .select("id, company_name, license_number, license_status, phone, city")
          .or(`company_name.ilike.%${textQuery}%,license_number.ilike.%${textQuery}%`)
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        return await enrichWithTrades(data || []);
      } else {
        // Trade search with pagination
        const { data: mappings, error: mappingError } = await supabase
          .from("sub_trade_mappings")
          .select("sub_id")
          .in("trade_type_id", selectedTradeIds);

        if (mappingError) throw mappingError;

        const uniqueSubIds = [...new Set(mappings?.map((m) => m.sub_id) || [])];

        if (uniqueSubIds.length === 0) {
          return [];
        }

        // Get paginated subs from the unique list
        const paginatedIds = uniqueSubIds.slice(offset, offset + PAGE_SIZE);

        const { data: subs, error: subError } = await supabase
          .from("subcontractors")
          .select("id, company_name, license_number, license_status, phone, city")
          .in("id", paginatedIds);

        if (subError) throw subError;

        return await enrichWithTrades(subs || []);
      }
    } catch (error) {
      console.error("Fetch page error:", error);
      throw error;
    }
  };

  // Get total count for current search
  const fetchTotalCount = async (): Promise<number> => {
    try {
      if (searchMode === "text") {
        const { count, error } = await supabase
          .from("subcontractors")
          .select("id", { count: "exact", head: true })
          .or(`company_name.ilike.%${textQuery}%,license_number.ilike.%${textQuery}%`);

        if (error) throw error;
        return count || 0;
      } else {
        const { data: mappings, error: mappingError } = await supabase
          .from("sub_trade_mappings")
          .select("sub_id")
          .in("trade_type_id", selectedTradeIds);

        if (mappingError) throw mappingError;

        const uniqueSubIds = new Set(mappings?.map((m) => m.sub_id) || []);
        return uniqueSubIds.size;
      }
    } catch (error) {
      console.error("Count error:", error);
      return 0;
    }
  };

  // Enrich subcontractors with their trades
  const enrichWithTrades = async (
    subs: { id: string; company_name: string; license_number: string | null; license_status: string | null; phone: string | null; city: string | null }[]
  ): Promise<NetworkSubcontractor[]> => {
    if (subs.length === 0) return [];

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

    return subs.map((sub) => ({
      ...sub,
      trades: tradesMap.get(sub.id) || [],
    }));
  };

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
    setCurrentPage(1);

    try {
      const [count, pageData] = await Promise.all([
        fetchTotalCount(),
        fetchPage(1),
      ]);

      setTotalCount(count);
      setResults(pageData);
    } catch (error) {
      console.error("Search error:", error);
      toast({
        title: "Search failed",
        description: "Unable to search the network. Please try again.",
        variant: "destructive",
      });
      setResults([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePageChange = async (newPage: number) => {
    setIsLoading(true);
    try {
      const pageData = await fetchPage(newPage);
      setResults(pageData);
      setCurrentPage(newPage);
    } catch (error) {
      console.error("Page change error:", error);
      toast({
        title: "Failed to load page",
        description: "Unable to load results. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setTextQuery("");
    setSelectedTradeIds([]);
    setResults([]);
    setHasSearched(false);
    setCurrentPage(1);
    setTotalCount(0);
  };

  // Fetch ALL matching results for export (not just current page)
  const fetchAllForExport = async (): Promise<NetworkSubcontractor[]> => {
    const allResults: NetworkSubcontractor[] = [];
    const batchSize = 500; // Fetch in batches to handle large datasets

    try {
      if (searchMode === "text") {
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from("subcontractors")
            .select("id, company_name, license_number, license_status, phone, city")
            .or(`company_name.ilike.%${textQuery}%,license_number.ilike.%${textQuery}%`)
            .range(offset, offset + batchSize - 1);

          if (error) throw error;

          if (data && data.length > 0) {
            const enriched = await enrichWithTrades(data);
            allResults.push(...enriched);
            offset += batchSize;
            hasMore = data.length === batchSize;
          } else {
            hasMore = false;
          }
        }
      } else {
        // Trade search: get all matching sub IDs first
        const { data: mappings, error: mappingError } = await supabase
          .from("sub_trade_mappings")
          .select("sub_id")
          .in("trade_type_id", selectedTradeIds);

        if (mappingError) throw mappingError;

        const uniqueSubIds = [...new Set(mappings?.map((m) => m.sub_id) || [])];

        // Fetch subs in batches
        for (let i = 0; i < uniqueSubIds.length; i += batchSize) {
          const batchIds = uniqueSubIds.slice(i, i + batchSize);
          
          const { data: subs, error: subError } = await supabase
            .from("subcontractors")
            .select("id, company_name, license_number, license_status, phone, city")
            .in("id", batchIds);

          if (subError) throw subError;

          if (subs && subs.length > 0) {
            const enriched = await enrichWithTrades(subs);
            allResults.push(...enriched);
          }
        }
      }

      return allResults;
    } catch (error) {
      console.error("Export fetch error:", error);
      throw error;
    }
  };

  const handleExport = async () => {
    if (!hasSearched || totalCount === 0) {
      toast({
        title: "No data to export",
        description: "Search for subcontractors first, then export the results.",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);

    try {
      const allData = await fetchAllForExport();

      const exportData = allData.map((sub) => ({
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
        description: `Exported ${allData.length} subcontractors to Excel.`,
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: "Export failed",
        description: "Unable to export data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
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

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const showPagination = totalPages > 1;

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
            <div className="flex flex-col">
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={!hasSearched || totalCount === 0 || isExporting}
              >
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? "Exporting..." : "Export to Excel"}
              </Button>
              {hasSearched && totalCount > 0 && (
                <span className="text-xs text-muted-foreground mt-1">
                  Exports all {totalCount.toLocaleString()} results
                </span>
              )}
            </div>
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
        ) : results.length === 0 && !isLoading ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No subcontractors found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Try adjusting your search criteria or searching with different terms.
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-muted/50 border-b border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {totalCount.toLocaleString()} {totalCount === 1 ? "result" : "results"} found
                {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
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
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : (
                  results.map((sub) => (
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
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            {showPagination && (
              <div className="px-4 py-3 bg-muted/50 border-t border-border flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages || isLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
