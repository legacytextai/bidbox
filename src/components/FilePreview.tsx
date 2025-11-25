import { useState } from "react";
import { FileText, FileSpreadsheet, FileImage, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

interface FilePreviewProps {
  files: ProjectFile[];
}

const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />;
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
      return <FileImage className="h-5 w-5 text-blue-500" />;
    default:
      return <FileIcon className="h-5 w-5 text-muted-foreground" />;
  }
};

const getFilePreviewUrl = (fileUrl: string): string => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/project-files/${fileUrl}`;
};

const FilePreview = ({ files }: FilePreviewProps) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No files to preview
      </div>
    );
  }

  const selectedFile = files[selectedFileIndex];
  const isPdf = selectedFile.file_name.toLowerCase().endsWith('.pdf');
  const previewUrl = getFilePreviewUrl(selectedFile.file_url);

  return (
    <div className="flex gap-4 h-[500px]">
      {/* Left: File List */}
      <ScrollArea className="w-1/3 border border-border rounded-lg">
        <div className="p-2 space-y-1">
          {files.map((file, index) => (
            <Button
              key={file.id}
              variant={selectedFileIndex === index ? "secondary" : "ghost"}
              className="w-full justify-start text-left"
              onClick={() => setSelectedFileIndex(index)}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                {getFileIcon(file.file_name)}
                <span className="truncate text-sm">{file.file_name}</span>
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>

      {/* Right: Preview Pane */}
      <div className="flex-1 border border-border rounded-lg bg-muted/20">
        {isPdf ? (
          <iframe
            src={previewUrl}
            className="w-full h-full rounded-lg"
            title={selectedFile.file_name}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            {getFileIcon(selectedFile.file_name)}
            <p className="mt-4 text-sm font-medium text-foreground">
              {selectedFile.file_name}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Preview not available for this file type
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please download to view
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreview;
