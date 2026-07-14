'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('security migration removes broad candidate updates and public project files', () => {
  const migration = read('supabase/migrations/20260714033000_harden_candidate_and_project_files_access.sql');
  assert.match(migration, /DROP POLICY IF EXISTS "Authenticated users can review candidates"/);
  assert.match(migration, /REVOKE UPDATE ON public\.opportunity_candidates FROM authenticated/);
  assert.match(migration, /DROP POLICY IF EXISTS "Public can download project files"/);
  assert.match(migration, /SET public = false/);
});

test('frontend no longer updates shared candidates or constructs public project-file URLs', () => {
  for (const file of ['src/pages/Opportunities.tsx', 'src/pages/OpportunityReport.tsx']) {
    assert.doesNotMatch(read(file), /from\(["']opportunity_candidates["']\)[\s\S]{0,160}?\.update\(/);
  }
  assert.doesNotMatch(read('src/components/FilePreview.tsx'), /storage\/v1\/object\/public\/project-files/);
  assert.match(read('src/components/FilePreview.tsx'), /createSignedUrl\(selectedFileUrl, 3600\)/);
});
