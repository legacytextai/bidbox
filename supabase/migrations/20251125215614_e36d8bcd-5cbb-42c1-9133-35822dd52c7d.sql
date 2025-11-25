-- Make project-files bucket public so files can be previewed in the public bid room
UPDATE storage.buckets 
SET public = true 
WHERE id = 'project-files';