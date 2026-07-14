import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CA_COUNTIES } from "@/lib/californiaRegions";
import { fetchTradeTypes, groupTradesByCategory, type TradeType } from "@/lib/tradeTypes";
import { ALL_NAICS_CODES, NAICS_SECTORS } from "@/lib/naicsCodes";
import { ChevronDown, X, Loader2, Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useQualificationJob } from "@/hooks/useQualificationJob";

type SaveStage = "idle" | "saving" | "requalifying" | "done";

interface ProfileRow {
  target_counties: string[];
  licenses_held: string[];
  naics_codes: string[];
  min_project_value: number | null;
  max_project_value: number | null;
}

const EMPTY_PROFILE: ProfileRow = {
  target_counties: [],
  licenses_held: [],
  naics_codes: [],
  min_project_value: null,
  max_project_value: null,
};

function parseCurrency(input: string): number | null {
  const cleaned = input.replace(/[^\d]/g, "");
  if (!cleaned) return null;
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value: number | null): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("en-US");
}

interface MultiSelectProps {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  emptyLabel?: string;
}

const MultiSelect = ({ options, selected, onChange, placeholder, emptyLabel }: MultiSelectProps) => {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-full justify-between font-normal"
          >
            <span className={selected.length === 0 ? "text-muted-foreground" : "text-foreground"}>
              {selected.length === 0 ? (emptyLabel ?? placeholder) : `${selected.length} selected`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <ScrollArea className="h-72">
            <div className="p-2 space-y-1">
              {options.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(opt.value)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-foreground leading-snug">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((value) => {
            const opt = options.find((o) => o.value === value);
            return (
              <Badge key={value} variant="secondary" className="gap-1 pr-1">
                <span>{opt?.label ?? value}</span>
                <button
                  type="button"
                  onClick={() => toggle(value)}
                  className="ml-0.5 rounded hover:bg-background/60 p-0.5"
                  aria-label={`Remove ${opt?.label ?? value}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <section className="bg-card border border-border rounded-lg p-6 space-y-4">
    <div className="space-y-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
    {children}
  </section>
);

const QualificationProfile = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saveStage, setSaveStage] = useState<SaveStage>("idle");
  const saving = saveStage === "saving";
  const [profile, setProfile] = useState<ProfileRow>(EMPTY_PROFILE);
  const [userId, setUserId] = useState<string | null>(null);
  const [trades, setTrades] = useState<TradeType[]>([]);
  const saveInFlight = useRef(false);
  const qualification = useQualificationJob(userId);

  const countyOptions = useMemo(
    () => CA_COUNTIES.map((c) => ({ value: c, label: c })),
    [],
  );

  const licenseOptions = useMemo(() => {
    // Group by category (parents + C-61 D-code children nested after C-61),
    // matching the ordering used by the Subs Network and project workspace selectors.
    const grouped = groupTradesByCategory(trades);
    const ordered: TradeType[] = [];
    Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .forEach((category) => {
        ordered.push(...grouped[category]);
      });
    return ordered.map((t) => ({
      value: t.code,
      label: t.parent_code
        ? `Class ${t.code} — ${t.name}`
        : `Class ${t.code} — ${t.name}`,
    }));
  }, [trades]);

  const naicsOptions = useMemo(
    () =>
      ALL_NAICS_CODES.map((c) => ({
        value: c.code,
        label: `${c.code} — ${c.description}`,
      })),
    [],
  );

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }
    setUserId(session.user.id);

    const { data, error } = await (supabase as any)
      .from("gc_qualification_profiles")
      .select("target_counties, licenses_held, naics_codes, min_project_value, max_project_value")
      .eq("profile_id", session.user.id)
      .maybeSingle();

    if (error) {
      toast({
        title: "Error",
        description: "Failed to load your bid profile",
        variant: "destructive",
      });
    } else if (data) {
      setProfile({
        target_counties: data.target_counties ?? [],
        licenses_held: data.licenses_held ?? [],
        naics_codes: data.naics_codes ?? [],
        min_project_value: data.min_project_value ?? null,
        max_project_value: data.max_project_value ?? null,
      });
    }

    setLoading(false);
  }, [navigate, toast]);

  useEffect(() => {
    load();
    fetchTradeTypes("CA").then(setTrades).catch(() => setTrades([]));
  }, [load]);

  const handleSave = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaveStage("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }

      if (
        profile.min_project_value !== null &&
        profile.max_project_value !== null &&
        profile.min_project_value > profile.max_project_value
      ) {
        toast({
          title: "Invalid value range",
          description: "Minimum project value cannot exceed the maximum.",
          variant: "destructive",
        });
        setSaveStage("idle");
        return;
      }

      const payload = {
        profile_id: session.user.id,
        target_counties: profile.target_counties,
        licenses_held: profile.licenses_held,
        naics_codes: profile.naics_codes,
        min_project_value: profile.min_project_value,
        max_project_value: profile.max_project_value,
      };

      const { error: upsertError } = await (supabase as any)
        .from("gc_qualification_profiles")
        .upsert(payload, { onConflict: "profile_id" });

      if (upsertError) {
        toast({
          title: "Save failed",
          description: upsertError.message ?? "Could not save your profile",
          variant: "destructive",
        });
        setSaveStage("idle");
        return;
      }

      const { error: queueError } = await supabase.rpc(
        "queue_qualification_rebuild",
        { p_bid_profile_id: null },
      );

      if (queueError) {
        toast({
          title: "Profile saved",
          description: "The opportunity update could not be queued. Your previous results are unchanged.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Profile saved",
          description: "Updating opportunities in the background. You may leave this page.",
        });
        await qualification.refresh();
      }
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
      setSaveStage("idle");
      return;
    } finally {
      saveInFlight.current = false;
    }
    setSaveStage("done");
    setTimeout(() => setSaveStage("idle"), 1500);
  };

  return (
    <Layout showSidebar={true}>
      {loading ? (
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Loading your bid profile...</p>
        </div>
      ) : (
        <div className="p-8 max-w-3xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Bid Profile</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Set your bid parameters once. Every discovered opportunity is auto-qualified against
              this profile so you only review what's worth bidding.
            </p>
          </div>

          <div className="space-y-6">
            <Section
              title="Geography"
              description="Counties where you actively bid. Anything outside these is auto-flagged."
            >
              <MultiSelect
                options={countyOptions}
                selected={profile.target_counties}
                onChange={(next) => setProfile((p) => ({ ...p, target_counties: next }))}
                placeholder="Select counties"
                emptyLabel="No counties selected"
              />
            </Section>

            <Section
              title="Project Size"
              description="Projects outside this band are auto-flagged."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-value">Minimum Value</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="min-value"
                      inputMode="numeric"
                      value={formatCurrency(profile.min_project_value)}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, min_project_value: parseCurrency(e.target.value) }))
                      }
                      placeholder="2,000,000"
                      className="pl-7"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-value">Maximum Value</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="max-value"
                      inputMode="numeric"
                      value={formatCurrency(profile.max_project_value)}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, max_project_value: parseCurrency(e.target.value) }))
                      }
                      placeholder="15,000,000"
                      className="pl-7"
                    />
                  </div>
                </div>
              </div>
            </Section>

            <Section
              title="Licensing"
              description="License classes your company holds."
            >
              <MultiSelect
                options={licenseOptions}
                selected={profile.licenses_held}
                onChange={(next) => setProfile((p) => ({ ...p, licenses_held: next }))}
                placeholder="Select license classes"
                emptyLabel="No license classes selected"
              />
            </Section>

            <Section
              title="NAICS Codes"
              description="Select the NAICS codes that apply to your business."
            >
              <MultiSelect
                options={naicsOptions}
                selected={profile.naics_codes}
                onChange={(next) => setProfile((p) => ({ ...p, naics_codes: next }))}
                placeholder="Select NAICS codes"
                emptyLabel="No NAICS codes selected"
              />
            </Section>

            <div className="flex flex-col items-end gap-3 pt-2">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90 min-w-[220px]"
              >
                {saveStage === "saving" && (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving profile…
                  </>
                )}
                {saveStage === "done" && (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Saved
                  </>
                )}
                {saveStage === "idle" && "Save Profile"}
              </Button>

              {qualification.isUpdating && (
                <div className="w-full max-w-sm animate-fade-in space-y-2">
                  <Progress
                    value={qualification.job?.total_candidates
                      ? (qualification.job.processed_candidates / qualification.job.total_candidates) * 100
                      : undefined}
                    className="h-1.5 overflow-hidden [&>div]:bg-[hsl(var(--bidbox-blue))]"
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    Opportunity evaluation in progress
                    {qualification.job?.total_candidates
                      ? ` — ${qualification.job.processed_candidates} of ${qualification.job.total_candidates}`
                      : ""}. You may navigate away.
                  </p>
                </div>
              )}
              {qualification.job?.status === "failed" && (
                <div className="w-full max-w-sm text-right space-y-2">
                  <p className="text-xs text-destructive">
                    The update failed. Your previous complete results are still active.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void qualification.retry()}>
                    Retry opportunity update
                  </Button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </Layout>
  );
};

export default QualificationProfile;
