const path = require('path');
const yauzl = require('yauzl');

const DEFAULT_MAX_EXTRACTED_FILES = 100;
const DEFAULT_MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const DEFAULT_MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_BYTES = 750 * 1024 * 1024;

const SUPPORTED_EXTRACTED_EXTENSIONS = new Set(['.pdf']);
const UNSAFE_EXTENSIONS = new Set([
  '.app',
  '.bat',
  '.bin',
  '.cmd',
  '.com',
  '.dll',
  '.dmg',
  '.exe',
  '.jar',
  '.js',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
]);

function envNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function archiveLimits() {
  return {
    maxFiles: envNumber('ARCHIVE_MAX_EXTRACTED_FILES', DEFAULT_MAX_EXTRACTED_FILES),
    maxTotalBytes: envNumber('ARCHIVE_MAX_EXTRACTED_BYTES', DEFAULT_MAX_EXTRACTED_BYTES),
    maxSingleFileBytes: envNumber('ARCHIVE_MAX_SINGLE_FILE_BYTES', DEFAULT_MAX_SINGLE_FILE_BYTES),
    maxArchiveBytes: envNumber('ARCHIVE_MAX_BYTES', DEFAULT_MAX_ARCHIVE_BYTES),
  };
}

function isArchiveFile(fileName) {
  return String(fileName ?? '').toLowerCase().endsWith('.zip');
}

function normalizeArchivePath(entryPath) {
  return String(entryPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function archiveEntryDecision(entryPath, uncompressedSize, limits = archiveLimits()) {
  const normalized = normalizeArchivePath(entryPath);
  const baseName = path.posix.basename(normalized);
  const ext = path.posix.extname(baseName).toLowerCase();

  if (!normalized || normalized.endsWith('/')) return { action: 'skip', reason: 'directory' };
  if (normalized.split('/').includes('__MACOSX')) return { action: 'skip', reason: 'macosx_metadata' };
  if (baseName === '.DS_Store') return { action: 'skip', reason: 'ds_store' };
  if (normalized.includes('..')) return { action: 'skip', reason: 'unsafe_path' };
  if (UNSAFE_EXTENSIONS.has(ext)) return { action: 'skip', reason: 'unsafe_file_type' };
  if (ext === '.zip') return { action: 'skip', reason: 'nested_archive_unsupported' };
  if (!SUPPORTED_EXTRACTED_EXTENSIONS.has(ext)) return { action: 'skip', reason: 'unsupported_file_type' };
  if (uncompressedSize > limits.maxSingleFileBytes) return { action: 'skip', reason: 'extracted_file_too_large' };
  return { action: 'extract', reason: null };
}

function openZipFromBuffer(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, zipfile) => {
      if (error) reject(error);
      else resolve(zipfile);
    });
  });
}

function readEntryBytes(zipfile, entry, limits) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (streamError, stream) => {
      if (streamError) {
        reject(streamError);
        return;
      }

      const chunks = [];
      let total = 0;
      stream.on('data', (chunk) => {
        total += chunk.byteLength;
        if (total > limits.maxSingleFileBytes) {
          stream.destroy(new Error('Extracted file exceeded max size'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks, total)));
    });
  });
}

async function extractSupportedArchiveEntries(bytes, log = () => {}) {
  const limits = archiveLimits();
  const archiveBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (archiveBytes.byteLength > limits.maxArchiveBytes) {
    return {
      entries: [],
      stats: {
        total_entries: 0,
        extracted: 0,
        skipped: 0,
        failed: 0,
        total_extracted_bytes: 0,
        rejected: true,
        reason: 'archive_too_large',
      },
      skipped: [{ entry_path: null, reason: 'archive_too_large' }],
      failures: [],
    };
  }

  const zipfile = await openZipFromBuffer(archiveBytes);
  const entries = [];
  const skipped = [];
  const failures = [];
  const stats = {
    total_entries: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    total_extracted_bytes: 0,
    rejected: false,
    reason: null,
  };

  try {
    await new Promise((resolve, reject) => {
      zipfile.on('entry', async (entry) => {
        stats.total_entries++;
        const entryPath = normalizeArchivePath(entry.fileName);
        const decision = archiveEntryDecision(entryPath, entry.uncompressedSize, limits);

        try {
          if (decision.action !== 'extract') {
            stats.skipped++;
            skipped.push({ entry_path: entryPath, reason: decision.reason });
            zipfile.readEntry();
            return;
          }

          if (stats.extracted >= limits.maxFiles) {
            stats.skipped++;
            skipped.push({ entry_path: entryPath, reason: 'max_file_count_reached' });
            zipfile.readEntry();
            return;
          }

          if (stats.total_extracted_bytes + entry.uncompressedSize > limits.maxTotalBytes) {
            stats.skipped++;
            skipped.push({ entry_path: entryPath, reason: 'max_total_extracted_size_reached' });
            zipfile.readEntry();
            return;
          }

          const entryBytes = await readEntryBytes(zipfile, entry, limits);
          stats.extracted++;
          stats.total_extracted_bytes += entryBytes.byteLength;
          entries.push({
            entry_path: entryPath,
            file_name: path.posix.basename(entryPath),
            bytes: entryBytes,
            file_size: entryBytes.byteLength,
            compressed_size: entry.compressedSize,
            uncompressed_size: entry.uncompressedSize,
          });
          zipfile.readEntry();
        } catch (e) {
          stats.failed++;
          failures.push({ entry_path: entryPath, error: e.message });
          log(`Archive entry extraction failed: ${entryPath}: ${e.message}`);
          zipfile.readEntry();
        }
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  return { entries, stats, skipped, failures };
}

module.exports = {
  archiveEntryDecision,
  archiveLimits,
  extractSupportedArchiveEntries,
  isArchiveFile,
  SUPPORTED_EXTRACTED_EXTENSIONS,
};
