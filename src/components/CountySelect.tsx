import { useState, useMemo } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { CA_COUNTIES, getRegionDisplayName } from "@/lib/californiaRegions";

interface CountySelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CountySelect({
  value,
  onChange,
  disabled = false,
  placeholder = "Select county...",
}: CountySelectProps) {
  const [open, setOpen] = useState(false);

  // Build county options with region info
  const countyOptions = useMemo(() => {
    return CA_COUNTIES.map((county) => ({
      value: county,
      label: county,
      region: getRegionDisplayName(county) || "",
    }));
  }, []);

  const selectedCounty = countyOptions.find((c) => c.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between bg-background"
        >
          {selectedCounty ? (
            <span className="flex items-center gap-2">
              <span>{selectedCounty.label}</span>
              <span className="text-xs text-muted-foreground">
                — {selectedCounty.region}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-background z-50" align="start">
        <Command>
          <CommandInput placeholder="Search county..." />
          <CommandList className="max-h-[300px] overscroll-contain">
            <CommandEmpty>No county found.</CommandEmpty>
            <CommandGroup>
              {countyOptions.map((county) => (
                <CommandItem
                  key={county.value}
                  value={county.label}
                  onSelect={() => {
                    onChange(county.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === county.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span>{county.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {county.region}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
