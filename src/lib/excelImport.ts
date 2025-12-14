import * as XLSX from 'xlsx';

export interface ParsedRow {
  license_number: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
  confidence: 'high' | 'medium' | 'low';
  rawData: Record<string, any>;
}

export interface ColumnMapping {
  license_number: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  notes: string | null;
}

export interface ParseResult {
  success: boolean;
  rows: ParsedRow[];
  detectedMapping: ColumnMapping;
  headers: string[];
  overallConfidence: 'high' | 'medium' | 'low';
  error?: string;
}

// Patterns for column detection
const LICENSE_PATTERNS = /license|lic|cslb|contractor/i;
const COMPANY_PATTERNS = /company|contractor|business|firm|name/i;
const CONTACT_PATTERNS = /contact|person|rep|representative/i;
const PHONE_PATTERNS = /phone|tel|mobile|cell/i;
const EMAIL_PATTERNS = /email|e-mail|mail/i;
const CITY_PATTERNS = /city|location|town/i;
const NOTES_PATTERNS = /notes|comments|remarks|memo/i;

// Value patterns for validation
const LICENSE_VALUE_PATTERN = /^\d{5,7}$/;
const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE_PATTERN = /[\d\-\(\)\s]{7,}/;

/**
 * Parse Excel or CSV file and detect columns using heuristics
 */
export function parseExcelFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with headers
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { 
          defval: '',
          raw: false,
        });
        
        if (jsonData.length === 0) {
          resolve({
            success: false,
            rows: [],
            detectedMapping: createEmptyMapping(),
            headers: [],
            overallConfidence: 'low',
            error: 'File appears to be empty or unreadable',
          });
          return;
        }
        
        // Get headers
        const headers = Object.keys(jsonData[0]);
        
        // Detect column mapping
        const detectedMapping = detectColumnMapping(headers, jsonData.slice(0, 20));
        
        // Parse rows using detected mapping
        const rows = jsonData.map(row => parseRow(row, detectedMapping));
        
        // Calculate overall confidence
        const confidenceCounts = { high: 0, medium: 0, low: 0 };
        rows.forEach(r => confidenceCounts[r.confidence]++);
        
        let overallConfidence: 'high' | 'medium' | 'low' = 'high';
        if (confidenceCounts.low > rows.length * 0.3) {
          overallConfidence = 'low';
        } else if (confidenceCounts.medium > rows.length * 0.3) {
          overallConfidence = 'medium';
        }
        
        // Also check if required fields are detected
        if (!detectedMapping.company_name && !detectedMapping.license_number) {
          overallConfidence = 'low';
        }
        
        resolve({
          success: true,
          rows,
          detectedMapping,
          headers,
          overallConfidence,
        });
      } catch (error) {
        console.error('Excel parse error:', error);
        resolve({
          success: false,
          rows: [],
          detectedMapping: createEmptyMapping(),
          headers: [],
          overallConfidence: 'low',
          error: 'Failed to parse file. Please ensure it is a valid Excel or CSV file.',
        });
      }
    };
    
    reader.onerror = () => {
      resolve({
        success: false,
        rows: [],
        detectedMapping: createEmptyMapping(),
        headers: [],
        overallConfidence: 'low',
        error: 'Failed to read file',
      });
    };
    
    reader.readAsArrayBuffer(file);
  });
}

function createEmptyMapping(): ColumnMapping {
  return {
    license_number: null,
    company_name: null,
    contact_name: null,
    phone: null,
    email: null,
    city: null,
    notes: null,
  };
}

/**
 * Detect column mapping using header patterns and sample data
 */
function detectColumnMapping(
  headers: string[], 
  sampleRows: Record<string, any>[]
): ColumnMapping {
  const mapping = createEmptyMapping();
  const usedHeaders = new Set<string>();
  
  // Score each header for each field type
  const scores: Record<string, Record<keyof ColumnMapping, number>> = {};
  
  for (const header of headers) {
    scores[header] = {
      license_number: 0,
      company_name: 0,
      contact_name: 0,
      phone: 0,
      email: 0,
      city: 0,
      notes: 0,
    };
    
    const headerLower = header.toLowerCase();
    
    // Score based on header name
    if (LICENSE_PATTERNS.test(headerLower)) scores[header].license_number += 10;
    if (COMPANY_PATTERNS.test(headerLower)) scores[header].company_name += 10;
    if (CONTACT_PATTERNS.test(headerLower)) scores[header].contact_name += 10;
    if (PHONE_PATTERNS.test(headerLower)) scores[header].phone += 10;
    if (EMAIL_PATTERNS.test(headerLower)) scores[header].email += 10;
    if (CITY_PATTERNS.test(headerLower)) scores[header].city += 10;
    if (NOTES_PATTERNS.test(headerLower)) scores[header].notes += 5;
    
    // Score based on sample values
    for (const row of sampleRows) {
      const value = String(row[header] || '').trim();
      if (!value) continue;
      
      // License: 5-7 digit number
      if (LICENSE_VALUE_PATTERN.test(value)) {
        scores[header].license_number += 3;
      }
      
      // Email pattern
      if (EMAIL_VALUE_PATTERN.test(value)) {
        scores[header].email += 5;
      }
      
      // Phone pattern
      if (PHONE_VALUE_PATTERN.test(value) && !EMAIL_VALUE_PATTERN.test(value)) {
        scores[header].phone += 3;
      }
    }
  }
  
  // Assign fields based on highest scores
  const fields: (keyof ColumnMapping)[] = [
    'license_number', 'email', 'phone', 'company_name', 
    'contact_name', 'city', 'notes'
  ];
  
  for (const field of fields) {
    let bestHeader: string | null = null;
    let bestScore = 0;
    
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      const score = scores[header][field];
      if (score > bestScore) {
        bestScore = score;
        bestHeader = header;
      }
    }
    
    // Only assign if score is above threshold
    const threshold = field === 'notes' ? 3 : 5;
    if (bestHeader && bestScore >= threshold) {
      mapping[field] = bestHeader;
      usedHeaders.add(bestHeader);
    }
  }
  
  // If no company_name detected, try to find a "name" column
  if (!mapping.company_name) {
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      if (/^name$/i.test(header.trim())) {
        mapping.company_name = header;
        usedHeaders.add(header);
        break;
      }
    }
  }
  
  return mapping;
}

/**
 * Parse a single row using the detected mapping
 */
function parseRow(
  row: Record<string, any>, 
  mapping: ColumnMapping
): ParsedRow {
  const getValue = (field: keyof ColumnMapping): string | null => {
    const header = mapping[field];
    if (!header) return null;
    const value = String(row[header] || '').trim();
    return value || null;
  };
  
  const license_number = getValue('license_number');
  const company_name = getValue('company_name');
  const contact_name = getValue('contact_name');
  const phone = getValue('phone');
  const email = getValue('email');
  const city = getValue('city');
  const notes = getValue('notes');
  
  // Calculate row confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  
  // Must have either license or company name
  if (!license_number && !company_name) {
    confidence = 'low';
  } else if (!company_name) {
    // License only - medium confidence
    confidence = 'medium';
  } else if (license_number && LICENSE_VALUE_PATTERN.test(license_number)) {
    // Has valid license format
    confidence = 'high';
  } else if (company_name && !license_number) {
    // Company only
    confidence = 'medium';
  }
  
  // Validate email format if present
  if (email && !EMAIL_VALUE_PATTERN.test(email)) {
    confidence = confidence === 'high' ? 'medium' : confidence;
  }
  
  return {
    license_number,
    company_name,
    contact_name,
    phone,
    email,
    city,
    notes,
    confidence,
    rawData: row,
  };
}

/**
 * Re-parse rows with updated mapping
 */
export function reparseWithMapping(
  rows: Record<string, any>[],
  mapping: ColumnMapping
): ParsedRow[] {
  return rows.map(row => parseRow(row, mapping));
}
