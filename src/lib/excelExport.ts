import * as XLSX from 'xlsx';
import { CallListEntry } from './callListGenerator';
import { BidListResult } from './bidListGenerator';

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
 * Export bid list to Excel file with two sheets: My Subs and Network Subs
 */
export function exportBidListToExcel(
  result: BidListResult,
  projectName: string
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: My Subs (Private Pool)
  const privateData = result.privateSubs.map(sub => ({
    'Company Name': sub.company_name || '',
    'Contact Name': sub.contact_name || '',
    'Phone': sub.phone || '',
    'Email': sub.email || '',
    'City': sub.city || '',
    'Trades': sub.trades || '',
    'Notes': sub.notes || '',
  }));

  const wsPrivate = XLSX.utils.json_to_sheet(privateData);
  wsPrivate['!cols'] = [
    { wch: 30 }, // Company Name
    { wch: 20 }, // Contact Name
    { wch: 15 }, // Phone
    { wch: 25 }, // Email
    { wch: 15 }, // City
    { wch: 40 }, // Trades
    { wch: 30 }, // Notes
  ];
  XLSX.utils.book_append_sheet(wb, wsPrivate, 'My Subs');

  // Sheet 2: Network Subs
  const networkData = result.networkSubs.map(sub => ({
    'Business Name': sub.business_name || '',
    'License #': sub.license_number || '',
    'Phone': sub.phone || '',
    'City': sub.city || '',
    'County': sub.county || '',
    'Classification(s)': sub.classifications || '',
  }));

  const wsNetwork = XLSX.utils.json_to_sheet(networkData);
  wsNetwork['!cols'] = [
    { wch: 30 }, // Business Name
    { wch: 12 }, // License #
    { wch: 15 }, // Phone
    { wch: 15 }, // City
    { wch: 15 }, // County
    { wch: 50 }, // Classification(s)
  ];
  XLSX.utils.book_append_sheet(wb, wsNetwork, 'Network Subs');

  // Generate filename
  const sanitizedName = projectName
    .replace(/[^a-z0-9]/gi, '_')
    .substring(0, 50);
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sanitizedName}_BidList_${date}.xlsx`;

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
