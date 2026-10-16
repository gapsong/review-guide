// Which tracked files the God Files view measures, and in which language family.
//
// Tests are left out: a test file that changes with its code is how it should be, and its many
// names are not an interface. Generated and vendored code is left out: nobody owns it by reading it.

export type Language = "typescript" | "python" | "other";

// The language families whose breadth is measured through imports. Every other source language is
// measured on history only, and its breadth shows as "–".
const typescriptExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const pythonExtensions = [".py"];
const otherSourceExtensions = [
  ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".rb", ".php", ".cs", ".fs", ".swift",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".m", ".mm", ".dart", ".ex", ".exs",
  ".erl", ".clj", ".lua", ".vue", ".svelte",
];

const testFolders = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]);
const generatedFolders = new Set(["node_modules", "dist", "build", "generated", "__generated__", "vendor"]);

export function languageOf(repoPath: string): Language | undefined {
  const extension = extensionOf(repoPath);
  if (typescriptExtensions.includes(extension)) {
    return "typescript";
  }
  if (pythonExtensions.includes(extension)) {
    return "python";
  }
  return otherSourceExtensions.includes(extension) ? "other" : undefined;
}

// excludeGlobs: the setting reviewGuide.godFiles.exclude, matched against the whole repo path.
export function isMeasuredSource(repoPath: string, excludeGlobs: RegExp[]): boolean {
  return languageOf(repoPath) !== undefined
    && !isTest(repoPath)
    && !isGeneratedOrVendored(repoPath)
    && !excludeGlobs.some((glob) => glob.test(repoPath));
}

function isTest(repoPath: string): boolean {
  const parts = repoPath.split("/");
  const name = parts[parts.length - 1];
  return parts.slice(0, -1).some((folder) => testFolders.has(folder))
    || /^test_.*\.py$/.test(name)
    || /_test\.[^.]+$/.test(name)
    || /\.(test|spec)\.[^.]+$/.test(name)
    || name === "conftest.py";
}

function isGeneratedOrVendored(repoPath: string): boolean {
  const parts = repoPath.split("/");
  const name = parts[parts.length - 1];
  return parts.slice(0, -1).some((folder) => generatedFolders.has(folder))
    || /\.d\.[mc]?ts$/.test(name)
    || name.endsWith(".min.js");
}

function extensionOf(repoPath: string): string {
  const name = repoPath.slice(repoPath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

// A glob as VS Code's settings write them: "**" any number of folders, "*" any text within one
// path part. A glob without "/" matches a file name in any folder.
export function globToRegExp(glob: string): RegExp {
  const trimmed = glob.trim().replace(/^\.\//, "");
  const anywhere = trimmed.includes("/") ? trimmed : `**/${trimmed}`;
  const pattern = anywhere.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === "**/") {
      return "(?:.*/)?";
    }
    if (part === "**") {
      return ".*";
    }
    return part === "*" ? "[^/]*" : part.replace(/[.+?^$()|[\]{}\\]/g, "\\$&");
  });
  return new RegExp(`^${pattern.join("")}$`);
}

// Code lines: lines that are neither blank nor a comment ("//", "/*" or "*" at the start, "#" in
// Python). A cheap rule: code lines are shown and decide the candidates, but never enter the score.
export function countCodeLines(text: string, language: Language): number {
  const comment = language === "python" ? /^#/ : /^(\/\/|\/\*|\*)/;
  return text.split(/\r?\n/).filter((line) => line.trim() !== "" && !comment.test(line.trim())).length;
}
