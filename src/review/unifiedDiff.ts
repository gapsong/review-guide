export type ChangeKind = "added" | "removed" | "context";

export interface DiffLine {
  kind: ChangeKind;
  text: string;
  // Line number in the old file (removed and context lines).
  oldLine?: number;
  // Line number in the new file (added and context lines).
  newLine?: number;
  // For a removed line: the line of the new file where it used to be.
  newAnchor?: number;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  isBinary: boolean;
  hunks: Hunk[];
}

// Parses the output of `git diff` (unified format, with the default a/ and b/ prefixes).
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = startFile(line);
      files.push(file);
      hunk = undefined;
    } else if (!file || isNoNewlineMarker(line)) {
      continue;
    } else if (hunk && isHunkBodyLine(line)) {
      const diffLine = readHunkLine(line, oldLine, newLine);
      hunk.lines.push(diffLine);
      oldLine += diffLine.kind === "added" ? 0 : 1;
      newLine += diffLine.kind === "removed" ? 0 : 1;
    } else if (line.startsWith("@@ ")) {
      hunk = startHunk(line);
      file.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
    } else {
      readFileHeaderLine(line, file);
    }
  }
  return files;
}

function startFile(diffGitLine: string): FileDiff {
  // "diff --git a/x b/x" is ambiguous when paths contain spaces; the ---/+++ lines below correct it.
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(diffGitLine);
  const oldPath = match ? match[1] : "";
  const newPath = match ? match[2] : "";
  return { oldPath, newPath, status: "modified", isBinary: false, hunks: [] };
}

function startHunk(header: string): Hunk {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) {
    throw new Error(`Not a hunk header: ${header}`);
  }
  return { oldStart: Number(match[1]), newStart: Number(match[2]), lines: [] };
}

function isHunkBodyLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-") || line.startsWith(" ");
}

function isNoNewlineMarker(line: string): boolean {
  return line.startsWith("\\ No newline at end of file");
}

function readHunkLine(line: string, oldLine: number, newLine: number): DiffLine {
  const text = line.slice(1);
  if (line.startsWith("+")) {
    return { kind: "added", text, newLine };
  }
  if (line.startsWith("-")) {
    return { kind: "removed", text, oldLine, newAnchor: newLine };
  }
  return { kind: "context", text, oldLine, newLine };
}

function readFileHeaderLine(line: string, file: FileDiff): void {
  if (line.startsWith("new file mode")) {
    file.status = "added";
  } else if (line.startsWith("deleted file mode")) {
    file.status = "deleted";
  } else if (line.startsWith("rename from ")) {
    file.status = "renamed";
    file.oldPath = line.slice("rename from ".length);
  } else if (line.startsWith("rename to ")) {
    file.newPath = line.slice("rename to ".length);
  } else if (line.startsWith("Binary files ")) {
    file.isBinary = true;
  } else if (line.startsWith("--- a/")) {
    file.oldPath = withoutTrailingTab(line.slice("--- a/".length));
  } else if (line.startsWith("+++ b/")) {
    file.newPath = withoutTrailingTab(line.slice("+++ b/".length));
  }
}

// git ends the ---/+++ line with a tab when the path contains a space.
function withoutTrailingTab(path: string): string {
  return path.replace(/\t$/, "");
}
