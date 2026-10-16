// The owner's rule, in numbers: a big file is fine only as a well-designed deep module. So a file is
// judged by how much of it other files use (breadth) and by how many reasons it has to change
// (history), never by its length. Every threshold of the God Files view lives here, so each one is
// switched in one place (README, "God files").

export const godFileRules = {
  // More names used by other files than this, and the file's interface is broad.
  broadAboveNamesUsedOutside: 7,
  // A file with a narrow interface is called a deep module only from this many code lines on;
  // a short file with a narrow interface is just a small file.
  deepFromCodeLines: 300,
  // A deep module has one reason to change. A file whose commits also touch files of more areas than
  // this changes for more reasons than one, so it gets no deep hint however narrow it is. Calibrated
  // on fastapi (routing.py, applications.py: 1 area) and vscode-pull-request-github (its narrow
  // 1,000-line files change with 5 to 10 areas); see REPORT.md.
  deepAtMostCoChangeAreas: 3,
  // A commit that touches more files than this is a sweep (a rename, a formatter run); its files did
  // not change together for one reason, so it does not count as co-change.
  largestCoChangeCommitFiles: 25,
  // The second, shorter window shown next to the main one.
  recentDays: 30,
};

// The settings' defaults (package.json, reviewGuide.godFiles.*).
export const godFileDefaults = {
  days: 90,
  minCodeLines: 150,
  maxItems: 20,
};

export type GodFileHint = "god file?" | "deep" | undefined;

// Only a hint: Claude's verdict (Judge with Claude) is the real judgment. A file whose breadth is
// not known gets no hint, because no hint is better than a wrong one. "deep" needs all three: a
// narrow interface (class members included), enough code to hide, and few reasons to change. A file
// nobody imports (an entry point, or unused) has no interface to be deep behind.
export function hintOf(namesUsedOutside: number | undefined, codeLines: number, coChangeAreas: number): GodFileHint {
  if (namesUsedOutside === undefined) {
    return undefined;
  }
  if (isBroad(namesUsedOutside)) {
    return "god file?";
  }
  return isDeep(namesUsedOutside, codeLines, coChangeAreas) ? "deep" : undefined;
}

export function isDeep(namesUsedOutside: number, codeLines: number, coChangeAreas: number): boolean {
  return namesUsedOutside >= 1 && !isBroad(namesUsedOutside) && codeLines >= godFileRules.deepFromCodeLines && coChangeAreas <= godFileRules.deepAtMostCoChangeAreas;
}

export function isBroad(namesUsedOutside: number): boolean {
  return namesUsedOutside > godFileRules.broadAboveNamesUsedOutside;
}

// Folders that only hold other parts: in a monorepo, apps/web and apps/api are two areas, not one.
const containerFolders = new Set(["apps", "packages", "libs", "services", "src", "modules", "crates", "internal", "pkg", "cmd"]);

// The area of a repo path: its first folder, or its first two when the first is a container folder.
// A file directly in the repo root, or directly in a container folder, is in the area of that folder.
export function areaOf(repoPath: string): string {
  const parts = repoPath.split("/");
  const folders = parts.slice(0, -1);
  if (folders.length === 0) {
    return ".";
  }
  if (containerFolders.has(folders[0]) && folders.length >= 2) {
    return `${folders[0]}/${folders[1]}`;
  }
  return folders[0];
}
