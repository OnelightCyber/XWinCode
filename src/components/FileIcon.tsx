import { Bird, Braces, File, FileCode, FileCog, FileImage, FileText, Folder, FolderOpen, Package } from "lucide-react";
import { basename, extname } from "../lib/paths";

interface Props {
  path: string;
  isDir?: boolean;
  open?: boolean;
  size?: number;
}

export function FileIcon({ path, isDir, open, size = 15 }: Props) {
  if (isDir) {
    return open ? (
      <FolderOpen size={size} className="fi fi-dir" />
    ) : (
      <Folder size={size} className="fi fi-dir" fill="currentColor" fillOpacity={0.18} />
    );
  }
  const name = basename(path).toLowerCase();
  if (name === "package.swift") return <Package size={size} className="fi fi-strong" />;
  switch (extname(path)) {
    case "swift":
      return <Bird size={size} className="fi fi-swift" />;
    case "json":
    case "resolved":
      return <Braces size={size} className="fi" />;
    case "yml":
    case "yaml":
    case "plist":
    case "entitlements":
    case "toml":
      return <FileCog size={size} className="fi" />;
    case "md":
    case "txt":
      return <FileText size={size} className="fi" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return <FileImage size={size} className="fi" />;
    case "c":
    case "h":
    case "m":
    case "cpp":
    case "js":
    case "ts":
    case "sh":
      return <FileCode size={size} className="fi" />;
    default:
      return <File size={size} className="fi fi-dim" />;
  }
}
