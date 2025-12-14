import { useState, useEffect, useMemo } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TradeType,
  fetchTradeTypes,
  groupTradesByCategory,
  getCategoryColor,
  formatTradeDisplay,
} from "@/lib/tradeTypes";

interface TradeMultiSelectProps {
  selectedTradeIds: string[];
  onSelectionChange: (tradeIds: string[]) => void;
  disabled?: boolean;
  stateCode?: string;
}

export function TradeMultiSelect({
  selectedTradeIds,
  onSelectionChange,
  disabled = false,
  stateCode = "CA",
}: TradeMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [trades, setTrades] = useState<TradeType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTrades = async () => {
      setLoading(true);
      const data = await fetchTradeTypes(stateCode);
      setTrades(data);
      setLoading(false);
    };
    loadTrades();
  }, [stateCode]);

  const groupedTrades = useMemo(() => groupTradesByCategory(trades), [trades]);

  const selectedTrades = useMemo(
    () => trades.filter((t) => selectedTradeIds.includes(t.id)),
    [trades, selectedTradeIds]
  );

  const toggleTrade = (tradeId: string) => {
    if (selectedTradeIds.includes(tradeId)) {
      onSelectionChange(selectedTradeIds.filter((id) => id !== tradeId));
    } else {
      onSelectionChange([...selectedTradeIds, tradeId]);
    }
  };

  const removeTrade = (tradeId: string) => {
    onSelectionChange(selectedTradeIds.filter((id) => id !== tradeId));
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={disabled || loading}
          >
            {loading
              ? "Loading trades..."
              : selectedTradeIds.length === 0
              ? "Select required trades..."
              : `${selectedTradeIds.length} trade${selectedTradeIds.length > 1 ? "s" : ""} selected`}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0 bg-background z-50 pointer-events-auto" align="start">
          <Command>
            <CommandInput placeholder="Search trades by name or code..." />
            <CommandList className="max-h-[300px] overflow-y-auto overscroll-contain pointer-events-auto">
              <CommandEmpty>No trades found.</CommandEmpty>
              {Object.entries(groupedTrades).map(([category, categoryTrades]) => (
                <CommandGroup key={category} heading={category}>
                  {categoryTrades.map((trade) => (
                    <CommandItem
                      key={trade.id}
                      value={`${trade.code} ${trade.name}`}
                      onSelect={() => toggleTrade(trade.id)}
                      className="cursor-pointer"
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedTradeIds.includes(trade.id)
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <span className="font-mono text-xs mr-2 text-muted-foreground">
                        {trade.code}
                      </span>
                      <span>{trade.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected trades as badges */}
      {selectedTrades.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTrades.map((trade) => (
            <Badge
              key={trade.id}
              variant="outline"
              className={cn(
                "px-2 py-1 text-xs font-medium border",
                getCategoryColor(trade.category)
              )}
            >
              <span className="font-mono mr-1">{trade.code}</span>
              {trade.name}
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    removeTrade(trade.id);
                  }}
                  className="ml-1.5 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
