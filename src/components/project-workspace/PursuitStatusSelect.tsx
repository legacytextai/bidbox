import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PURSUIT_STATUSES,
  PURSUIT_STATUS_LABELS,
  PURSUIT_STATUS_STYLES,
  normalizePursuitStatus,
} from "@/lib/pursuitStatus";

interface PursuitStatusSelectProps {
  projectId: string;
  value: string | null | undefined;
  onChange?: (value: string) => void;
  className?: string;
}

export function PursuitStatusSelect({
  projectId,
  value,
  onChange,
  className,
}: PursuitStatusSelectProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<string>(normalizePursuitStatus(value));
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: string) => {
    const prev = status;
    setSaving(true);
    setStatus(next);
    onChange?.(next);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          pursuit_status: next,
          pursuit_status_updated_at: new Date().toISOString(),
        } as never)
        .eq("id", projectId);
      if (error) throw error;
    } catch (e: unknown) {
      setStatus(prev);
      onChange?.(prev);
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: "Failed to update project status", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const ps = normalizePursuitStatus(status);

  return (
    <Select value={ps} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className={`w-36 h-9 text-sm ${PURSUIT_STATUS_STYLES[ps]} ${className ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PURSUIT_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className={PURSUIT_STATUS_STYLES[s]}>
            {PURSUIT_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
