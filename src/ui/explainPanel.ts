import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ExplainRequest } from "../claude/explainPrompt";
import { explanationFolderOf, explanationPageName, explanationsFolder } from "../codemap/explanationFiles";
import { cleanRelativePath, repoPathOf } from "../codemap/repoPath";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { ExplainHeader, ExplainMessage, renderExplainPanel, renderExplanationPage } from "./explainHtml";

interface OpenExplanation {
  folder: vscode.WorkspaceFolder;
  repoPath: string;
  kind: "file" | "folder";
  panel: vscode.WebviewPanel;
  // The page shown, relative to the explanation folder.
  page: string;
}

export type StartGeneration = (folder: vscode.WorkspaceFolder, request: ExplainRequest) => void;

// The Explain panels, one per path: the codemap entry, then the generated explanation page.
// A panel redraws itself when its page is written or its codemap entry changes.
export class ExplainPanels implements vscode.Disposable {
  static readonly viewType = "reviewGuide.explain";
  private readonly open = new Map<string, OpenExplanation>();
  private readonly watcher = vscode.workspace.createFileSystemWatcher(`**/${explanationsFolder}/**/*.html`);

  constructor(
    private readonly codemaps: WorkspaceCodemaps,
    private readonly startGeneration: StartGeneration,
    private readonly showError: (error: unknown) => void,
  ) {
    codemaps.onDidChange(() => this.renderAll());
    const pageChanged = (uri: vscode.Uri) => this.renderShowing(uri);
    this.watcher.onDidCreate(pageChanged);
    this.watcher.onDidChange(pageChanged);
    this.watcher.onDidDelete(pageChanged);
  }

  async show(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      throw new Error("Explain works on a file or folder inside an open workspace folder.");
    }
    const key = keyOf(folder, repoPath);
    const alreadyOpen = this.open.get(key);
    if (alreadyOpen) {
      alreadyOpen.panel.reveal();
      return;
    }
    const isFolder = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
    const panel = vscode.window.createWebviewPanel(ExplainPanels.viewType, `Explain: ${path.basename(uri.fsPath)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(folder.uri, explanationsFolder)],
    });
    const explanation: OpenExplanation = { folder, repoPath, kind: isFolder ? "folder" : "file", panel, page: explanationPageName };
    this.open.set(key, explanation);
    panel.onDidDispose(() => this.open.delete(key));
    panel.webview.onDidReceiveMessage((message: ExplainMessage) => this.handle(explanation, message).catch(this.showError));
    this.render(explanation);
  }

  // What the panel's buttons and links send. Public so tests can press them.
  async receive(uri: vscode.Uri, message: ExplainMessage): Promise<void> {
    const explanation = this.openFor(uri);
    if (explanation) {
      await this.handle(explanation, message);
    }
  }

  htmlOf(uri: vscode.Uri): string | undefined {
    return this.openFor(uri)?.panel.webview.html;
  }

  dispose(): void {
    this.watcher.dispose();
    for (const explanation of this.open.values()) {
      explanation.panel.dispose();
    }
  }

  private async handle(explanation: OpenExplanation, message: ExplainMessage): Promise<void> {
    switch (message.type) {
      case "generate":
        this.startGeneration(explanation.folder, {
          path: explanation.repoPath,
          kind: explanation.kind,
          entry: this.codemaps.entryOf(vscode.Uri.joinPath(explanation.folder.uri, explanation.repoPath)),
        });
        return;
      case "showIndex":
        explanation.page = explanationPageName;
        this.render(explanation);
        return;
      case "openLink":
        await this.openLink(explanation, message.target);
        return;
    }
  }

  // A link to another page of the explanation opens in the panel; a link to any other of its
  // files (an image, a recording) opens in VS Code.
  private async openLink(explanation: OpenExplanation, target: string): Promise<void> {
    const page = cleanRelativePath(target);
    if (page === undefined || !fs.existsSync(this.fileOf(explanation, page))) {
      return;
    }
    if (page.toLowerCase().endsWith(".html")) {
      explanation.page = page;
      this.render(explanation);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(this.fileOf(explanation, page)));
  }

  private renderAll(): void {
    for (const explanation of this.open.values()) {
      this.render(explanation);
    }
  }

  private renderShowing(changedFile: vscode.Uri): void {
    for (const explanation of this.open.values()) {
      const shown = [this.fileOf(explanation, explanation.page), this.fileOf(explanation, explanationPageName)];
      if (shown.includes(changedFile.fsPath)) {
        this.render(explanation);
      }
    }
  }

  private render(explanation: OpenExplanation): void {
    if (!fs.existsSync(this.fileOf(explanation, explanation.page))) {
      explanation.page = explanationPageName;
    }
    const pageFile = this.fileOf(explanation, explanation.page);
    const { webview } = explanation.panel;
    const header: ExplainHeader = {
      path: explanation.repoPath,
      entry: this.codemaps.entryOf(vscode.Uri.joinPath(explanation.folder.uri, explanation.repoPath)),
      hasExplanation: fs.existsSync(pageFile),
      otherPage: explanation.page === explanationPageName ? undefined : explanation.page,
    };
    if (!header.hasExplanation) {
      webview.html = renderExplainPanel(header, randomBytes(16).toString("hex"), webview.cspSource);
      return;
    }
    const page = {
      html: fs.readFileSync(pageFile, "utf8"),
      baseUrl: `${webview.asWebviewUri(vscode.Uri.file(path.dirname(pageFile)))}/`,
      folderUrl: `${webview.asWebviewUri(vscode.Uri.file(this.fileOf(explanation, "")))}/`,
    };
    webview.html = renderExplanationPage(page, header, webview.cspSource);
  }

  private openFor(uri: vscode.Uri): OpenExplanation | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    return folder && repoPath !== undefined ? this.open.get(keyOf(folder, repoPath)) : undefined;
  }

  // A file of the path's explanation folder on disk; "" is the folder itself.
  private fileOf(explanation: OpenExplanation, relativePath: string): string {
    return path.join(explanation.folder.uri.fsPath, explanationFolderOf(explanation.repoPath), relativePath);
  }
}

function keyOf(folder: vscode.WorkspaceFolder, repoPath: string): string {
  return `${folder.uri.toString()}#${repoPath}`;
}
