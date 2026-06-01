import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LICENSE_CLASSES } from "@/lib/licenseClasses";
import { ALL_NAICS_CODES, NAICS_SECTORS } from "@/lib/naicsCodes";
import { ChevronDown, X } from "lucide-react";

interface ProfileRow {
  target_counties: string[];
  licenses_held: string[];
  min_project_value: number | null;
  max_project_value: number | null;
}

const EMPTY_PROFILE: ProfileRow = {
  target_counties: [],
  licenses_held: [],
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
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileRow>(EMPTY_PROFILE);

  const countyOptions = useMemo(
    () => CA_COUNTIES.map((c) => ({ value: c, label: c })),
    [],
  );

  const licenseOptions = useMemo(
    () =>
      LICENSE_CLASSES.map((l) => ({
        value: l.code,
        label: `Class ${l.code} — ${l.name}`,
      })),
    [],
  );

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
      return;
    }

    const { data, error } = await (supabase as any)
      .from("gc_qualification_profiles")
      .select("target_counties, licenses_held, min_project_value, max_project_value")
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
        min_project_value: data.min_project_value ?? null,
        max_project_value: data.max_project_value ?? null,
      });
    }

    setLoading(false);
  }, [navigate, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
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
        setSaving(false);
        return;
      }

      const payload = {
        profile_id: session.user.id,
        target_counties: profile.target_counties,
        licenses_held: profile.licenses_held,
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
        setSaving(false);
        return;
      }

      const { data: qData, error: qError } = await supabase.functions.invoke(
        "qualify-candidates",
        { body: {} },
      );

      if (qError) {
        toast({
          title: "Profile saved",
          description: "Re-qualification failed — please try again shortly.",
          variant: "destructive",
        });
      } else {
        const evaluated = (qData as any)?.evaluated ?? 0;
        toast({
          title: "Profile saved",
          description: `${evaluated} ${evaluated === 1 ? "opportunity" : "opportunities"} re-evaluated`,
        });
      }
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
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
              title="Project Size"
              description="Dollar range you target. Projects outside this band are auto-flagged."
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

            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
              >
                {saving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default QualificationProfile;
