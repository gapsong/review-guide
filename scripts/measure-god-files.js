// Measures the God Files view's speed (SPEC.md, "God files"; REPORT.md). Needs `npm run compile` first.
//
//   node scripts/measure-god-files.js                 a generated repo: ~2,000 source files, ~3,000 commits in 90 days
//   node scripts/measure-god-files.js <repo> [...]    any git repos, e.g. clones of public projects
//
// Prints per repo: source files, commits in the window, candidates, wall-clock seconds, and the top files.
const { Buffer } = require("buffer");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { measureGodFiles, defaultGodFileOptions } = require("../out/src/godfiles/godFiles");

async function main() {
  const repos = process.argv.slice(2);
  if (repos.length === 0) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "review-guide-godfiles-perf-"));
    try {
      const repo = path.join(scratch, "generated");
      generateRepo(repo, { files: 2000, commits: 3000, days: 90 });
      await measure(repo);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
    return;
  }
  for (const repo of repos) {
    await measure(path.resolve(repo));
  }
}

async function measure(repo) {
  const start = process.hrtime.bigint();
  const report = await measureGodFiles(repo, defaultGodFileOptions);
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.log(`${path.basename(repo)}: ${report.sourceFileCount} source files, ${report.commitCount} commits in ${report.days} days, ${report.items.length} candidates, ${seconds.toFixed(2)} s`);
  for (const item of report.items.slice(0, 5)) {
    const names = item.namesUsedOutside === undefined ? "–" : `${item.namesUsedOutside.length} names used by ${item.filesUsingIt.length} files`;
    console.log(`  ${(item.score * 100).toFixed(0).padStart(3)}  ${(item.hint ?? "").padEnd(9)}  ${item.path}  ${names} · ${item.commitsInWindow} commits · ${item.coChangeAreas.length} areas · ${item.codeLines} lines`);
  }
}

// A repo of TypeScript and Python modules in a monorepo layout that import each other, with a
// history of small commits and a few sweeps, written with git fast-import (one process, seconds).
function generateRepo(repo, { files, commits, days }) {
  fs.mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: repo });
  const random = seededRandom(42);
  const modules = Array.from({ length: files }, (_, index) => moduleOf(index));
  const contents = modules.map((module) => moduleText(module, modules, random));
  const endSeconds = 1_790_000_000;
  const startSeconds = endSeconds - days * 24 * 60 * 60;
  let stream = "";
  const commit = (seconds, message, changes) => {
    stream += `commit refs/heads/main\ncommitter Test <test@example.com> ${seconds} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n`;
    for (const index of changes) {
      stream += `M 100644 inline ${modules[index].path}\ndata ${Buffer.byteLength(contents[index])}\n${contents[index]}\n`;
    }
  };
  commit(startSeconds - 24 * 60 * 60, "Start", modules.map((_, index) => index));
  for (let number = 1; number <= commits; number++) {
    const isSweep = number % 100 === 0;
    const size = isSweep ? 40 : 1 + Math.floor(random() * 6);
    const changed = new Set();
    const first = Math.floor(random() * files);
    for (let index = 0; changed.size < size; index++) {
      // Most commits stay near one module, so co-change has a shape; some reach across areas.
      changed.add(random() < 0.7 ? (first + index) % files : Math.floor(random() * files));
    }
    for (const index of changed) {
      contents[index] += modules[index].language === "python" ? `# change ${number}\n` : `// change ${number}\n`;
    }
    commit(startSeconds + Math.floor((number / commits) * days * 24 * 60 * 60), `Change ${number}`, [...changed]);
  }
  const result = spawnSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream, maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git fast-import failed: ${result.stderr}`);
  }
  execFileSync("git", ["reset", "--quiet", "--hard", "main"], { cwd: repo });
}

const areas = ["apps/web", "apps/api", "apps/admin", "packages/ui", "packages/billing", "packages/auth", "src/shop", "src/search", "libs/log", "services/mail"];

function moduleOf(index) {
  const language = index % 2 === 0 ? "typescript" : "python";
  const area = areas[index % areas.length];
  const folder = `m${Math.floor(index / 40)}`;
  const name = `module${index}`;
  return { index, language, area, path: `${area}/${folder}/${name}.${language === "python" ? "py" : "ts"}`, names: Array.from({ length: 2 + (index % 9) }, (_, n) => `${name}_f${n}`) };
}

function moduleText(module, modules, random) {
  const sameLanguage = modules.filter((other) => other.language === module.language && other.index !== module.index);
  const imported = Array.from({ length: 4 }, () => sameLanguage[Math.floor(random() * sameLanguage.length)]);
  const lines = [];
  for (const other of imported) {
    const names = other.names.slice(0, 1 + Math.floor(random() * other.names.length));
    if (module.language === "python") {
      lines.push(`from ${other.path.replace(/\.py$/, "").split("/").join(".")} import ${names.join(", ")}`);
    } else {
      lines.push(`import { ${names.join(", ")} } from "${path.posix.relative(path.posix.dirname(module.path), other.path).replace(/\.ts$/, "").replace(/^(?!\.)/, "./")}";`);
    }
  }
  const bodyLines = 10 + Math.floor(random() * 30);
  for (const name of module.names) {
    if (module.language === "python") {
      lines.push("", `def ${name}(value):`, ...Array.from({ length: bodyLines }, (_, n) => `    value = value + ${n}`), "    return value");
    } else {
      lines.push("", `export function ${name}(value: number): number {`, ...Array.from({ length: bodyLines }, (_, n) => `  value = value + ${n};`), "  return value;", "}");
    }
  }
  return `${lines.join("\n")}\n`;
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
