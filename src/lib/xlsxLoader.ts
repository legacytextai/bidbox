/**
 * Dynamic loader for SheetJS (xlsx) from CDN
 * Using CDN version to address npm vulnerability (ReDoS, Prototype Pollution in 0.18.5)
 * SheetJS stopped publishing to npm after 0.18.5; newer versions only available via CDN
 */

interface XLSXModule {
  utils: {
    json_to_sheet: (data: object[], opts?: object) => object;
    sheet_to_json: <T>(sheet: object, opts?: object) => T[];
    book_new: () => object;
    book_append_sheet: (workbook: object, sheet: object, name: string) => void;
  };
  read: (data: Uint8Array, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, object> };
  writeFile: (workbook: object, filename: string) => void;
}

let xlsxModule: XLSXModule | null = null;

/**
 * Load SheetJS library from CDN (cached after first load)
 */
export async function loadXLSX(): Promise<XLSXModule> {
  if (xlsxModule) {
    return xlsxModule;
  }

  try {
    // @ts-ignore - Dynamic import from CDN
    const module = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    xlsxModule = module as XLSXModule;
    return xlsxModule;
  } catch (error) {
    console.error('Failed to load SheetJS from CDN:', error);
    throw new Error('Failed to load Excel library. Please check your internet connection.');
  }
}
