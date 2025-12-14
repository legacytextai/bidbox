import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseExcelFile, ParseResult, ColumnMapping, ParsedRow, reparseWithMapping } from "@/lib/excelImport";
import { downloadImportTemplate } from "@/lib/excelExport";
import { addGCSubcontractor, lookupCSLBLicense } from "@/lib/subcontractorMatching";

interface ExcelImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onImportComplete: () => void;
}

type ImportStep = 'upload' | 'correction' | 'importing' | 'complete';

interface ImportResult {
  total: number;
  imported: number;
  enriched: number;
  failed: number;
  errors: string[];
}

export function ExcelImportDialog({
  open,
  onOpenChange,
  userId,
  onImportComplete,
}: ExcelImportDialogProps) {
  const { toast } = useToast();
  
  const [step, setStep] = useState<ImportStep>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [rawData, setRawData] = useState<Record<string, any>[]>([]);
  const [editedMapping, setEditedMapping] = useState<ColumnMapping | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const resetState = () => {
    setStep('upload');
    setParseResult(null);
    setRawData([]);
    setEditedMapping(null);
    setImportProgress(0);
    setImportResult(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleFile = async (file: File) => {
    // Validate file type
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const isValidType = validTypes.includes(file.type) || 
      file.name.endsWith('.xlsx') || 
      file.name.endsWith('.xls') || 
      file.name.endsWith('.csv');

    if (!isValidType) {
      toast({
        title: "Invalid file type",
        description: "Please upload an Excel (.xlsx, .xls) or CSV file.",
        variant: "destructive",
      });
      return;
    }

    const result = await parseExcelFile(file);
    setParseResult(result);
    
    if (!result.success) {
      toast({
        title: "Parse failed",
        description: result.error || "Failed to parse file",
        variant: "destructive",
      });
      return;
    }

    // Store raw data for potential re-parsing
    setRawData(result.rows.map(r => r.rawData));
    setEditedMapping(result.detectedMapping);

    // Check confidence - if high, auto-import
    if (result.overallConfidence === 'high') {
      await runImport(result.rows);
    } else {
      // Show correction step
      setStep('correction');
    }
  };

  const handleMappingChange = (field: keyof ColumnMapping, header: string | null) => {
    if (!editedMapping) return;
    
    const newMapping = { ...editedMapping, [field]: header };
    setEditedMapping(newMapping);
    
    // Re-parse with new mapping
    if (parseResult) {
      const newRows = reparseWithMapping(rawData, newMapping);
      setParseResult({
        ...parseResult,
        rows: newRows,
        detectedMapping: newMapping,
      });
    }
  };

  const runImport = async (rows: ParsedRow[]) => {
    setStep('importing');
    setImportProgress(0);

    const result: ImportResult = {
      total: rows.length,
      imported: 0,
      enriched: 0,
      failed: 0,
      errors: [],
    };

    const validRows = rows.filter(r => r.company_name || r.license_number);

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      setImportProgress(Math.round(((i + 1) / validRows.length) * 100));

      try {
        let subData: any = {
          company_name: row.company_name || 'Unknown Company',
          license_number: row.license_number || undefined,
          contact_name: row.contact_name || undefined,
          email: row.email || undefined,
          phone: row.phone || undefined,
          city: row.city || undefined,
          notes: row.notes || undefined,
          state_code: 'CA',
        };

        let tradeTypeIds: string[] = [];

        // Try CSLB enrichment if license number exists
        if (row.license_number) {
          try {
            const cslbData = await lookupCSLBLicense(row.license_number);
            
            if (cslbData?.success) {
              // Enrich with CSLB data
              if (cslbData.company_name) subData.company_name = cslbData.company_name;
              if (cslbData.license_status) subData.license_status = cslbData.license_status;
              if (cslbData.expiration_date) subData.license_expiration = cslbData.expiration_date;
              if (cslbData.city) subData.city = cslbData.city;
              if (cslbData.trade_type_ids) tradeTypeIds = cslbData.trade_type_ids;
              
              result.enriched++;
            }
          } catch (cslbError) {
            // CSLB lookup failed - continue without enrichment
            console.log('CSLB lookup skipped:', cslbError);
          }
        }

        await addGCSubcontractor(userId, subData, tradeTypeIds);
        result.imported++;
      } catch (error) {
        result.failed++;
        const errorMsg = `Row ${i + 1}: ${row.company_name || row.license_number || 'Unknown'} - Failed to import`;
        result.errors.push(errorMsg);
        console.error('Import error:', error);
      }
    }

    setImportResult(result);
    setStep('complete');
  };

  const handleContinueImport = async () => {
    if (parseResult) {
      await runImport(parseResult.rows);
    }
  };

  const renderUploadStep = () => (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-primary/50'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileInput}
          className="hidden"
          id="excel-upload"
        />
        <label htmlFor="excel-upload" className="cursor-pointer">
          <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium mb-2">
            Drop your Excel or CSV file here
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            or click to browse
          </p>
          <Button variant="outline" type="button">
            <Upload className="h-4 w-4 mr-2" />
            Choose File
          </Button>
        </label>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Download className="h-4 w-4" />
        <button 
          onClick={() => downloadImportTemplate()}
          className="underline hover:text-foreground transition-colors"
        >
          Download template spreadsheet
        </button>
      </div>
    </div>
  );

  const renderCorrectionStep = () => {
    if (!parseResult || !editedMapping) return null;

    const availableHeaders = ['', ...parseResult.headers];

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          <p className="text-sm">
            We couldn't confidently identify all columns. Please verify the mapping below.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Company Name</Label>
            <Select
              value={editedMapping.company_name || ''}
              onValueChange={(v) => handleMappingChange('company_name', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>License Number</Label>
            <Select
              value={editedMapping.license_number || ''}
              onValueChange={(v) => handleMappingChange('license_number', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Contact Name</Label>
            <Select
              value={editedMapping.contact_name || ''}
              onValueChange={(v) => handleMappingChange('contact_name', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Email</Label>
            <Select
              value={editedMapping.email || ''}
              onValueChange={(v) => handleMappingChange('email', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Phone</Label>
            <Select
              value={editedMapping.phone || ''}
              onValueChange={(v) => handleMappingChange('phone', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>City</Label>
            <Select
              value={editedMapping.city || ''}
              onValueChange={(v) => handleMappingChange('city', v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column" />
              </SelectTrigger>
              <SelectContent>
                {availableHeaders.map(h => (
                  <SelectItem key={h || 'none'} value={h || 'none'}>
                    {h || '(None)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            {parseResult.rows.length} rows detected
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetState}>
              Cancel
            </Button>
            <Button onClick={handleContinueImport}>
              Import {parseResult.rows.filter(r => r.company_name || r.license_number).length} Subcontractors
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderImportingStep = () => (
    <div className="space-y-4 py-8">
      <div className="flex items-center justify-center mb-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
      <p className="text-center text-lg font-medium">Importing subcontractors...</p>
      <Progress value={importProgress} className="w-full" />
      <p className="text-center text-sm text-muted-foreground">
        {importProgress}% complete
      </p>
    </div>
  );

  const renderCompleteStep = () => {
    if (!importResult) return null;

    return (
      <div className="space-y-4 py-4">
        <div className="flex items-center justify-center mb-4">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
        </div>
        <h3 className="text-center text-lg font-medium">Import Complete</h3>
        
        <div className="grid grid-cols-3 gap-4 py-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary">{importResult.imported}</p>
            <p className="text-sm text-muted-foreground">Imported</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{importResult.enriched}</p>
            <p className="text-sm text-muted-foreground">Enriched via CSLB</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-destructive">{importResult.failed}</p>
            <p className="text-sm text-muted-foreground">Failed</p>
          </div>
        </div>

        {importResult.errors.length > 0 && (
          <div className="max-h-32 overflow-y-auto border rounded p-2 text-sm">
            {importResult.errors.map((err, i) => (
              <p key={i} className="text-destructive">{err}</p>
            ))}
          </div>
        )}

        <div className="flex justify-center pt-4">
          <Button onClick={() => {
            handleClose();
            onImportComplete();
          }}>
            Done
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Import Subcontractors'}
            {step === 'correction' && 'Confirm Column Mapping'}
            {step === 'importing' && 'Importing...'}
            {step === 'complete' && 'Import Results'}
          </DialogTitle>
          {step === 'upload' && (
            <DialogDescription>
              Upload an Excel or CSV file with your subcontractor list. We'll automatically detect columns and import them.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 'upload' && renderUploadStep()}
        {step === 'correction' && renderCorrectionStep()}
        {step === 'importing' && renderImportingStep()}
        {step === 'complete' && renderCompleteStep()}
      </DialogContent>
    </Dialog>
  );
}
