import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { GodFileJudges } from "../analysis/godFileJudge";
import { ExplainRequest } from "../claude/explainPrompt";
import { mineBlockOf } from "../codemap/entryOwnership";
import { explanationFolderOf, explanationPageName, explanationsFolder } from "../codemap/explanationFiles";
import { cleanRelativePath, repoPathOf } from "../codemap/repoPath";
import { WorkspaceChangeMarkers } from "../codemap/workspaceChangeMarkers";
import { WorkspaceCodemaps } from "../codemap/workspaceCodemaps";
import { WorkspaceEntryOwnership } from "../codemap/workspaceEntryOwnership";
import { openStartOf } from "./codemapNavigation";
import { CodemapTarget, targetOf } from "./codemapTarget";
import { entryStatusOf } from "./entryStatus";
import { ExplainHeader, ExplainMessage, ExplainMode, renderExplainPanel, renderExplanationPage } from "./explainHtml";
import { GodFilesView } from "./godFilesView";
import { judgeHtml, judgeStyles } from "./godFileText";
import { ownershipLine } from "./ownershipText";
import { OwnItModel, renderOwnItPanel } from "./ownItHtml";

interface OpenExplanation {
  folder: vscode.WorkspaceFolder;
  repoPath: string;
  kind: "file" | "folder";
  panel: vscode.WebviewPanel;
  // The page shown, relative to the explanation folder.
  page: string;
  mode: ExplainMode;
  // What the owner typed into the chat's reply box and has not sent; it survives a redraw.
  draft: string | undefined;
  // Drawing "Own it" waits for git; only the newest drawing may land.
  renders: number;
  // Judge with Claude is running for this path.
  judging: boolean;
}

export type StartGeneration = (folder: vscode.WorkspaceFolder, request: ExplainRequest) => void;

export type ShowChanges = (target: CodemapTarget) => Promise<void>;

// The Explain panels, one per path: the codemap entry, then the generated explanation page,
// "Own it" with the owner's words, their check and the tutor chat, or "Judge" for a measured god
// file. A panel redraws itself when its page is written, its codemap entry, the owner's state of it
// or the god files change.
export class ExplainPanels implements vscode.Disposable {
  static readonly viewType = "reviewGuide.explain";
  private readonly open = new Map<string, OpenExplanation>();
  private readonly watcher = vscode.workspace.createFileSystemWatcher(`**/${explanationsFolder}/**/*.html`);

  constructor(
    private readonly codemaps: WorkspaceCodemaps,
    private readonly markers: WorkspaceChangeMarkers,
    private readonly ownership: WorkspaceEntryOwnership,
    private readonly godFiles: GodFilesView,
    private readonly judges: GodFileJudges,
    private readonly startGeneration: StartGeneration,
    private readonly showChanges: ShowChanges,
    private readonly showError: (error: unknown) => void,
  ) {
    codemaps.onDidChange(() => this.renderAll());
    markers.onDidChange(() => this.renderAll());
    ownership.onDidChange(() => this.renderAll());
    godFiles.onDidChangeTreeData(() => this.renderAll());
    const pageChanged = (uri: vscode.Uri) => this.renderShowing(uri);
    this.watcher.onDidCreate(pageChanged);
    this.watcher.onDidChange(pageChanged);
    this.watcher.onDidDelete(pageChanged);
  }

  // Opens the panel, or brings it forward; with a mode, it shows that view.
  async show(uri: vscode.Uri, mode?: ExplainMode): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const repoPath = folder && repoPathOf(folder.uri.fsPath, uri.fsPath);
    if (!folder || repoPath === undefined) {
      throw new Error("Explain works on a file or folder inside an open workspace folder.");
    }
    const key = keyOf(folder, repoPath);
    const alreadyOpen = this.open.get(key);
    if (alreadyOpen) {
      if (mode && mode !== alreadyOpen.mode) {
        alreadyOpen.mode = mode;
        this.render(alreadyOpen);
      }
      alreadyOpen.panel.reveal();
      return;
    }
    const isFolder = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
    const panel = vscode.window.createWebviewPanel(ExplainPanels.viewType, `Explain: ${path.basename(uri.fsPath)}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(folder.uri, explanationsFolder)],
    });
    const explanation: OpenExplanation = {
      folder, repoPath, kind: isFolder ? "folder" : "file", panel, page: explanationPageName, mode: mode ?? "explanation", draft: undefined, renders: 0, judging: false,
    };
    this.open.set(key, explanation);
    panel.onDidDispose(() => this.open.delete(key));
    panel.webview.onDidReceiveMessage((message: ExplainMessage) => this.handle(explanation, message).catch(this.showError));
    this.render(explanation);
  }

  // "Explain again" from the Codemap view or a CodeLens: the panel, and the terminal that writes the page.
  async explainAgain(uri: vscode.Uri): Promise<void> {
    await this.show(uri);
    await this.receive(uri, { type: "generate" });
  }

  // "Check my words" from the Codemap view, a tooltip or a CodeLens: the check runs in the open
  // "Own it" view, so the owner sees it running and its answer.
  async checkWords(uri: vscode.Uri): Promise<void> {
    await this.show(uri, "ownIt");
    await this.receive(uri, { type: "checkWords" });
  }

  // "Judge with Claude" from the God Files view: the panel's Judge view, and a run when this commit
  // has no judgment of the file yet. Claude never runs without this click or the panel's button.
  async judge(uri: vscode.Uri): Promise<void> {
    await this.show(uri, "judge");
    const explanation = this.openFor(uri);
    const measured = explanation && this.godFiles.measured(targetOf(explanation.folder, explanation.repoPath));
    if (!explanation || !measured || !this.judges.judgmentOf(explanation.folder.uri.fsPath, measured.item.path, measured.report.commit)) {
      await this.receive(uri, { type: "judgeWithClaude" });
    }
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
    const pathUri = vscode.Uri.joinPath(explanation.folder.uri, explanation.repoPath);
    switch (message.type) {
      case "generate":
        this.startGeneration(explanation.folder, { path: explanation.repoPath, kind: explanation.kind, entry: this.codemaps.entryOf(pathUri) });
        return;
      case "confirm":
        await this.markers.confirm(pathUri);
        return;
      case "showIndex":
        explanation.page = explanationPageName;
        this.render(explanation);
        return;
      case "openLink":
        await this.openLink(explanation, message.target);
        return;
      case "openStart": {
        const entry = this.codemaps.entryOf(pathUri);
        if (entry) {
          await openStartOf(targetOf(explanation.folder, explanation.repoPath), entry);
        }
        return;
      }
      case "explanation":
      case "ownIt":
      case "judge":
        explanation.mode = message.type;
        this.render(explanation);
        return;
      case "judgeWithClaude":
        await this.judgeWithClaude(explanation);
        return;
      case "openLine":
        // The path is the panel's own; the line came from a link the extension built from a checked line.
        if (Number.isInteger(message.line) && message.line >= 1) {
          const line = new vscode.Position(message.line - 1, 0);
          await vscode.window.showTextDocument(pathUri, { selection: new vscode.Range(line, line), viewColumn: vscode.ViewColumn.Beside });
        }
        return;
      case "checkWords":
        await this.ownership.check(pathUri);
        return;
      case "chat":
        await this.sendChat(explanation, pathUri, message.text);
        return;
      case "chatDraft":
        explanation.draft = message.text;
        return;
      case "editInCodemap":
        await this.openEntryInCodemap(pathUri);
        return;
      case "useAsMine":
        await this.useLastMessageAsMine(pathUri);
        return;
      case "showChanges":
        await this.showChanges(targetOf(explanation.folder, explanation.repoPath));
        return;
    }
  }

  private async judgeWithClaude(explanation: OpenExplanation): Promise<void> {
    const measured = this.godFiles.measured(targetOf(explanation.folder, explanation.repoPath));
    if (!measured) {
      throw new Error(`${explanation.repoPath} is not among the measured god files. Refresh God Files, then judge again.`);
    }
    if (explanation.judging) {
      return;
    }
    explanation.judging = true;
    this.render(explanation);
    try {
      await this.judges.judge(explanation.folder.uri.fsPath, measured.item, measured.report);
    } finally {
      explanation.judging = false;
      this.render(explanation);
    }
  }

  // The reply box keeps the text until Claude has answered, so a failed call loses nothing.
  private async sendChat(explanation: OpenExplanation, pathUri: vscode.Uri, text: string): Promise<void> {
    if (text.trim() === "") {
      return;
    }
    explanation.draft = text;
    await this.ownership.chat(pathUri, text);
    explanation.draft = undefined;
    this.render(explanation);
  }

  private async openEntryInCodemap(pathUri: vscode.Uri): Promise<void> {
    const place = this.codemaps.lineOf(pathUri);
    if (!place) {
      return;
    }
    const line = new vscode.Position((place.line ?? 1) - 1, 0);
    await vscode.window.showTextDocument(place.file, { selection: new vscode.Range(line, line), viewColumn: vscode.ViewColumn.Beside });
  }

  // The extension never writes the codemap: the owner pastes the block and saves.
  private async useLastMessageAsMine(pathUri: vscode.Uri): Promise<void> {
    const conversation = this.ownership.recordOf(pathUri)?.conversation ?? [];
    const last = [...conversation].reverse().find((turn) => turn.speaker === "owner");
    if (!last || last.speaker !== "owner") {
      return;
    }
    await vscode.env.clipboard.writeText(mineBlockOf(last.text));
    await this.openEntryInCodemap(pathUri);
    void vscode.window.showInformationMessage("Review Guide: your last message is on the clipboard as a mine block. Paste it over the entry's mine, save, then check your words.");
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
    const ticket = ++explanation.renders;
    this.draw(explanation, ticket).catch(this.showError);
  }

  // The explanation view is drawn at once; "Own it" asks git for the changes since the check first.
  private async draw(explanation: OpenExplanation, ticket: number): Promise<void> {
    if (!fs.existsSync(this.fileOf(explanation, explanation.page))) {
      explanation.page = explanationPageName;
    }
    const pageFile = this.fileOf(explanation, explanation.page);
    const { webview } = explanation.panel;
    const pathUri = vscode.Uri.joinPath(explanation.folder.uri, explanation.repoPath);
    const status = entryStatusOf(targetOf(explanation.folder, explanation.repoPath), this.markers, this.ownership);
    const entry = this.codemaps.entryOf(pathUri);
    const measured = this.godFiles.measured(targetOf(explanation.folder, explanation.repoPath));
    const shows = (explanation.mode === "ownIt" && entry) || (explanation.mode === "judge" && measured) ? explanation.mode : "explanation";
    const header: ExplainHeader = {
      path: explanation.repoPath,
      entry,
      hasExplanation: fs.existsSync(pageFile),
      explanationOlder: status.explanationOlder,
      change: status.change,
      otherPage: explanation.page === explanationPageName ? undefined : explanation.page,
      ownership: entry && status.ownership ? ownershipLine(status.ownership) : undefined,
      mode: shows,
      canJudge: measured !== undefined,
    };
    if (measured && shows === "judge") {
      const stored = this.judges.judgmentOf(explanation.folder.uri.fsPath, measured.item.path, measured.report.commit);
      const main = judgeHtml({ item: measured.item, commit: measured.report.commit, stored, judging: explanation.judging });
      webview.html = renderExplainPanel(header, randomBytes(16).toString("hex"), webview.cspSource, main, judgeStyles);
      return;
    }
    if (shows === "ownIt") {
      const model = await this.ownItModelOf(explanation, pathUri);
      if (ticket === explanation.renders) {
        webview.html = renderOwnItPanel(header, model, randomBytes(16).toString("hex"), webview.cspSource);
      }
      return;
    }
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

  private async ownItModelOf(explanation: OpenExplanation, pathUri: vscode.Uri): Promise<OwnItModel> {
    const record = this.ownership.recordOf(pathUri);
    const changes = record?.check ? await this.ownership.changesSinceCheck(pathUri).catch(() => undefined) : undefined;
    return {
      mine: this.codemaps.entryOf(pathUri)?.mine,
      state: this.ownership.stateOf(pathUri),
      lastCheck: record?.check,
      conversation: record?.conversation ?? [],
      draft: explanation.draft,
      work: this.ownership.workOn(pathUri),
      changes,
    };
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
