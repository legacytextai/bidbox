export const PROJECT_FILE_TYPES = [
  'application/pdf',
  'image/vnd.dwg', // DWG
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

export const BID_FILE_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed'
];

export const MAX_FILE_SIZE_MB = 200;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export function validateProjectFile(file: File): { valid: boolean; error?: string } {
  if (!PROJECT_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: 'Only PDF, DWG, and Excel files allowed' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File must be under ${MAX_FILE_SIZE_MB}MB` };
  }
  return { valid: true };
}

export function validateBidFile(file: File): { valid: boolean; error?: string } {
  if (!BID_FILE_TYPES.includes(file.type)) {
    return { valid: false, error: 'Only PDF, Excel, and ZIP files allowed' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File must be under ${MAX_FILE_SIZE_MB}MB` };
  }
  return { valid: true };
}
