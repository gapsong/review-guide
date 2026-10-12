import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CodemapEntry, CodemapProblem, entryLineOf, parseCodemap } from "./codemap";
import { repoPathOf } from "./repoPath";

// The codemap of every workspace folder, kept fresh: read at the start, read again whenever its
// file changes (no reload), and its problems shown in the Problems view.
export class WorkspaceCodemaps implements vscode.Disposable {
  private readonly entriesByFolder = new Map<string, Map<string, CodemapEntry>>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("codemap");
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private watchers: vscode.Disposable[] = [];
  private readonly subscriptions: vscode.Disposable[];

  // codemapFile: the codemap's path relative to each workspace folder.
  constructor(private readonly codemapFile: () => string) {
    this.subscriptions = [
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.loadAll()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("reviewGuide.codemapFile")) {
          this.loadAll();
        }
      }),
    ];
    this.loadAll();
  }

  // The workspace folders that have a codemap file, even one without valid entries.
  foldersWithCodemap(): vscode.WorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((folder) => this.entriesByFolder.has(folder.uri.toString()));
  }

  // In the order of the codemap file.
  entriesOf(folder: vscode.WorkspaceFolder): CodemapEntry[] {
    return [...(this.entriesByFolder.get(folder.uri.toString())?.values() ?? [])];
  }

  codemapFileOf(folder: vscode.WorkspaceFolder): vscode.Uri {
    return vscode.Uri.joinPath(folder.uri, this.codemapFile());
  }

  entryOf(uri: vscode.Uri): CodemapEntry | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      return undefined;
    }
    return this.entriesByFolder.get(folder.uri.toString())?.get(repoPath);
  }

  // Where an entry starts in its codemap file: the file and the line of its "path" (counting from 1).
  lineOf(uri: vscode.Uri): { file: vscode.Uri; line: number | undefined } | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      return undefined;
    }
    const file = this.codemapFileOf(folder);
    const text = fs.existsSync(file.fsPath) ? fs.readFileSync(file.fsPath, "utf8") : "";
    return { file, line: entryLineOf(text, repoPath) };
  }

  dispose(): void {
    disposeAll(this.watchers);
    disposeAll(this.subscriptions);
    this.diagnostics.dispose();
    this.changed.dispose();
  }

  // Starts over, because a new workspace folder or a new codemapFile setting changes which files are watched.
  private loadAll(): void {
    disposeAll(this.watchers);
    this.entriesByFolder.clear();
    this.diagnostics.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    this.watchers = folders.map((folder) => this.watch(folder));
    for (const folder of folders) {
      this.load(folder);
    }
    this.changed.fire();
  }

  private watch(folder: vscode.WorkspaceFolder): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, this.codemapFile()));
    const reload = () => {
      this.load(folder);
      this.changed.fire();
    };
    watcher.onDidCreate(reload);
    watcher.onDidChange(reload);
    watcher.onDidDelete(reload);
    return watcher;
  }

  // Most repos have no codemap; that is not a problem, it only means no badges.
  private load(folder: vscode.WorkspaceFolder): void {
    const file = path.join(folder.uri.fsPath, this.codemapFile());
    const fileUri = vscode.Uri.file(file);
    if (!fs.existsSync(file)) {
      this.entriesByFolder.delete(folder.uri.toString());
      this.diagnostics.delete(fileUri);
      return;
    }
    const text = fs.readFileSync(file, "utf8");
    const codemap = parseCodemap(text, (repoPath) => fs.existsSync(path.join(folder.uri.fsPath, repoPath)));
    this.entriesByFolder.set(folder.uri.toString(), new Map(codemap.entries.map((entry) => [entry.path, entry])));
    this.diagnostics.set(fileUri, codemap.problems.map((problem) => diagnosticOf(problem, text)));
  }
}

function diagnosticOf(problem: CodemapProblem, text: string): vscode.Diagnostic {
  const line = problem.line - 1;
  const lineLength = (text.split(/\r?\n/)[line] ?? "").length;
  const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, lineLength), problem.message, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = "codemap";
  return diagnostic;
}

function disposeAll(disposables: vscode.Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}
