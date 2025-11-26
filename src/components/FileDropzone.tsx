import { useState } from "react";
import { cn } from "@/lib/utils";

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function FileDropzone({
  onFilesSelected,
  accept,
  multiple = true,
  disabled = false,
  className,
  children,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      onFilesSelected(droppedFiles);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      onFilesSelected(selectedFiles);
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "transition-all duration-150",
        isDragging && !disabled && "border-primary bg-primary/5",
        className
      )}
    >
      <input
        type="file"
        multiple={multiple}
        onChange={handleFileSelect}
        className="hidden"
        id="file-dropzone-input"
        accept={accept}
        disabled={disabled}
      />
      <label
        htmlFor="file-dropzone-input"
        className={cn(
          "flex flex-col items-center justify-center h-full",
          disabled ? "cursor-not-allowed" : "cursor-pointer"
        )}
      >
        {children}
      </label>
    </div>
  );
}
