import * as XLSX from 'xlsx';
import { CallListEntry } from './callListGenerator';

/**
 * Export call list to Excel file and trigger download
 */
export function exportCallListToExcel(
  entries: CallListEntry[],
  projectName: string
): void {
  // Prepare data with headers
  const data = entries.map(entry => ({
    'Company Name': entry.company_name || '',
    'Contact Name': entry.contact_name || '',
    'Phone': entry.phone || '',
    'Email': entry.email || '',
    'Trades': entry.trades || '',
    'License Number': entry.license_number || '',
    'City': entry.city || '',
    'Notes': entry.notes || '',
  }));

  // Create worksheet
  const ws = XLSX.utils.json_to_sheet(data);

  // Set column widths
  ws['!cols'] = [
    { wch: 30 }, // Company Name
    { wch: 20 }, // Contact Name
    { wch: 15 }, // Phone
    { wch: 25 }, // Email
    { wch: 40 }, // Trades
    { wch: 12 }, // License Number
    { wch: 15 }, // City
    { wch: 30 }, // Notes
  ];

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Call List');

  // Generate filename
  const sanitizedName = projectName
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50);
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sanitizedName}_CallList_${date}.xlsx`;

  // Trigger download
  XLSX.writeFile(wb, filename);
}

/**
 * Create and download a template Excel file for subcontractor import
 */
export function downloadImportTemplate(): void {
  const templateData = [
    {
      'License Number': '1234567',
      'Company Name': 'Example Electric Inc',
      'Contact Name': 'John Smith',
      'Phone': '555-123-4567',
      'Email': 'john@example.com',
      'City': 'Los Angeles',
      'Notes': 'Preferred vendor',
    },
    {
      'License Number': '',
      'Company Name': 'Sample Plumbing LLC',
      'Contact Name': 'Jane Doe',
      'Phone': '555-987-6543',
      'Email': 'jane@sample.com',
      'City': 'San Diego',
      'Notes': '',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(templateData);

  ws['!cols'] = [
    { wch: 15 }, // License Number
    { wch: 25 }, // Company Name
    { wch: 20 }, // Contact Name
    { wch: 15 }, // Phone
    { wch: 25 }, // Email
    { wch: 15 }, // City
    { wch: 30 }, // Notes
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Template');

  XLSX.writeFile(wb, 'BidBox_Subcontractor_Import_Template.xlsx');
}
