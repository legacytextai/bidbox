import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { Search, Loader2, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { lookupCSLBLicense } from "@/lib/subcontractorMatching";
import { getCategoryColor } from "@/lib/tradeTypes";

interface SubcontractorFormData {
  company_name: string;
  license_number: string;
  license_status: string;
  license_expiration: string;
  contact_name: string;
  email: string;
  phone: string;
  city: string;
  state_code: string;
  notes: string;
}

interface SubcontractorFormProps {
  initialData?: Partial<SubcontractorFormData>;
  initialTradeIds?: string[];
  onSubmit: (data: SubcontractorFormData, tradeIds: string[]) => Promise<void>;
  onCancel: () => void;
  isSubmitting: boolean;
  submitLabel?: string;
}

export function SubcontractorForm({
  initialData,
  initialTradeIds = [],
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel = "Save Subcontractor",
}: SubcontractorFormProps) {
  const [formData, setFormData] = useState<SubcontractorFormData>({
    company_name: initialData?.company_name || "",
    license_number: initialData?.license_number || "",
    license_status: initialData?.license_status || "",
    license_expiration: initialData?.license_expiration || "",
    contact_name: initialData?.contact_name || "",
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    city: initialData?.city || "",
    state_code: initialData?.state_code || "CA",
    notes: initialData?.notes || "",
  });

  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>(initialTradeIds);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "success" | "error" | "info">("idle");
  const [lookupMessage, setLookupMessage] = useState("");

  const handleLookup = async () => {
    if (!formData.license_number.trim()) {
      setLookupStatus("error");
      setLookupMessage("Please enter a license number");
      return;
    }

    setIsLookingUp(true);
    setLookupStatus("idle");
    setLookupMessage("");

    try {
      const result = await lookupCSLBLicense(formData.license_number);

      if (result.success) {
        // Auto-fill the form from cache
        setFormData(prev => ({
          ...prev,
          company_name: result.company_name || prev.company_name,
          license_status: result.license_status || "",
          license_expiration: result.expiration_date || "",
          city: result.city || "",
          state_code: result.state_code || "CA",
        }));

        // Auto-select trades based on classifications
        if (result.classifications && result.classifications.length > 0) {
          const tradeIds = result.classifications
            .filter((c: any) => c.trade_type_id)
            .map((c: any) => c.trade_type_id);
          setSelectedTradeIds(tradeIds);
        }

        setLookupStatus("success");
        setLookupMessage(`Found: ${result.company_name}${result.cached ? " (cached)" : ""}`);
      } else if (result.manual_entry_required) {
        // Manual entry needed - open verification link (this is informational, not an error)
        if (result.verification_url) {
          window.open(result.verification_url, '_blank');
        }
        setLookupStatus("info");
        setLookupMessage("CSLB verification page opened — enter details from there.");
      } else {
        setLookupStatus("error");
        setLookupMessage(result.error || "License not found");
      }
    } catch (error) {
      console.error("Lookup error:", error);
      setLookupStatus("error");
      setLookupMessage("Failed to lookup license. You can enter details manually.");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData, selectedTradeIds);
  };

  const handleChange = (field: keyof SubcontractorFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* License Lookup Section */}
      <div className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
        <Label className="text-base font-semibold">CSLB License Lookup</Label>
        <p className="text-sm text-muted-foreground">
          Enter a California contractor license number to auto-fill company information and trades.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="e.g., 123456"
            value={formData.license_number}
            onChange={(e) => handleChange("license_number", e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleLookup}
            disabled={isLookingUp}
          >
            {isLookingUp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2">Lookup</span>
          </Button>
        </div>

        {lookupStatus !== "idle" && (
          <div className={`flex items-center gap-2 text-sm ${
            lookupStatus === "success" ? "text-green-600" : 
            lookupStatus === "info" ? "text-blue-600" : 
            "text-destructive"
          }`}>
            {lookupStatus === "success" ? (
              <CheckCircle className="h-4 w-4" />
            ) : lookupStatus === "info" ? (
              <ExternalLink className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {lookupMessage}
          </div>
        )}

        {formData.license_status && (
          <div className="flex items-center gap-2">
            <Badge variant={formData.license_status === "ACTIVE" ? "default" : "destructive"}>
              {formData.license_status}
            </Badge>
            {formData.license_expiration && (
              <span className="text-sm text-muted-foreground">
                Expires: {formData.license_expiration}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Company Information */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="company_name">Company Name *</Label>
          <Input
            id="company_name"
            value={formData.company_name}
            onChange={(e) => handleChange("company_name", e.target.value)}
            required
            placeholder="ABC Electric Inc."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={formData.city}
            onChange={(e) => handleChange("city", e.target.value)}
            placeholder="Los Angeles"
          />
        </div>
      </div>

      {/* Trades */}
      <div className="space-y-2">
        <Label>Trades</Label>
        <TradeMultiSelect
          selectedTradeIds={selectedTradeIds}
          onSelectionChange={setSelectedTradeIds}
          stateCode="CA"
        />
      </div>

      {/* Contact Information */}
      <div className="space-y-4">
        <Label className="text-base font-semibold">Contact Information</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="contact_name">Contact Name</Label>
            <Input
              id="contact_name"
              value={formData.contact_name}
              onChange={(e) => handleChange("contact_name", e.target.value)}
              placeholder="John Smith"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="john@abc-electric.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => handleChange("notes", e.target.value)}
          placeholder="Any additional notes about this subcontractor..."
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !formData.company_name.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  );
}
