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

export function isTest(repoPath: string): boolean {
  const parts = repoPath.split("/");
  const name = parts[parts.length - 1];
  return parts.slice(0, -1).some((folder) => testFolders.has(folder))
    || /^test_.*\.py$/.test(name)
    || /_test\.[^.]+$/.test(name)
    || /\.(test|spec)\.[^.]+$/.test(name)
    || name === "conftest.py";
}

export function isGeneratedOrVendored(repoPath: string): boolean {
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

// A glob as VS Code's settings write them: "**" any number of folders, "*" and "?" within one
// path part, "{a,b}" either. A glob without "/" matches a file name in any folder.
export function globToRegExp(glob: string): RegExp {
  const trimmed = glob.trim().replace(/^\.\//, "");
  if (trimmed === "") {
    throw new Error("An empty glob in reviewGuide.godFiles.exclude matches nothing; remove it.");
  }
  const anywhere = !trimmed.includes("/");
  const pattern = translateGlob(anywhere ? `**/${trimmed}` : trimmed);
  return new RegExp(`^${pattern}$`);
}

function translateGlob(glob: string): string {
  let pattern = "";
  let insideBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const character = glob[i];
    if (glob.startsWith("**/", i)) {
      pattern += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      pattern += ".*";
      i += 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else if (character === "?") {
      pattern += "[^/]";
    } else if (character === "{") {
      insideBraces = true;
      pattern += "(?:";
    } else if (character === "}" && insideBraces) {
      insideBraces = false;
      pattern += ")";
    } else if (character === "," && insideBraces) {
      pattern += "|";
    } else {
      pattern += character.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return pattern;
}
