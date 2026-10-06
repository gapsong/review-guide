import * as path from "path";

// A repo path names a file or folder relative to the workspace folder, with "/" between its parts,
// like `apps/api/main.py`. The codemap lists repo paths, and each one names its explanation's folder.

// The repo path of a file or folder on disk; undefined for the workspace folder itself or anything outside it.
export function repoPathOf(workspaceFolderPath: string, filePath: string): string | undefined {
  const relative = path.relative(workspaceFolderPath, filePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

// Tidies a relative path as the owner or a page writes it ("./apps/api/" becomes "apps/api").
// A path that could point outside its folder (absolute, or with "..") is refused with undefined:
// a repo path also names a folder that Claude writes into, and a page's link must stay in its folder.
export function cleanRelativePath(written: string): string | undefined {
  const cleaned = written.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (cleaned === "" || cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned)) {
    return undefined;
  }
  const parts = cleaned.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return undefined;
  }
  return cleaned;
}
