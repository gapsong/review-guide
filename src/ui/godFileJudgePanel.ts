import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { GodFileJudges } from "../analysis/godFileJudge";
import { CodemapTarget, uriOfTarget } from "./codemapTarget";
import { CodeLocation, JudgePanelMessage, JudgeWork, renderJudgePanel } from "./godFileJudgeHtml";
import { WorkspaceGodFiles } from "./workspaceGodFiles";

interface OpenJudgePanel {
  target: CodemapTarget;
  panel: vscode.WebviewPanel;
  work: JudgeWork;
  error: string | undefined;
  // What the panel's links point to, by index (godFileJudgeHtml.ts).
  locations: CodeLocation[];
  // A run may end after the owner closed the panel; a closed webview cannot be drawn.
  closed: boolean;
}

// The Judge with Claude panels, one per file. A panel never starts a run by itself: only
// "Judge with Claude" in the view's context menu or the panel's button does.
export class GodFileJudgePanels implements vscode.Disposable {
  static readonly viewType = "reviewGuide.godFileJudge";
  private readonly open = new Map<string, OpenJudgePanel>();

  constructor(
    private readonly godFiles: WorkspaceGodFiles,
    private readonly judges: GodFileJudges,
    private readonly showError: (error: unknown) => void,
  ) {
    godFiles.onDidChange(() => this.renderAll());
  }

  // Opens the panel, or brings it forward; with run, it also starts the judgment.
  async show(clicked: CodemapTarget, run: boolean): Promise<void> {
    const target = { folderUri: clicked.folderUri, path: clicked.path };
    const key = keyOf(target);
    let opened = this.open.get(key);
    if (!opened) {
      const panel = vscode.window.createWebviewPanel(GodFileJudgePanels.viewType, `Judge: ${target.path.split("/").pop()}`, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
      opened = { target, panel, work: "idle", error: undefined, locations: [], closed: false };
      const current = opened;
      this.open.set(key, current);
      panel.onDidDispose(() => {
        current.closed = true;
        this.open.delete(key);
      });
      panel.webview.onDidReceiveMessage((message: JudgePanelMessage) => this.handle(current, message).catch(this.showError));
    }
    opened.panel.reveal();
    this.render(opened);
    if (run) {
      await this.judge(opened);
    }
  }

  // What the panel's button and links send. Public so tests can press them.
  async receive(target: CodemapTarget, message: JudgePanelMessage): Promise<void> {
    const opened = this.open.get(keyOf(target));
    if (opened) {
      await this.handle(opened, message);
    }
  }

  htmlOf(target: CodemapTarget): string | undefined {
    return this.open.get(keyOf(target))?.panel.webview.html;
  }

  dispose(): void {
    for (const opened of this.open.values()) {
      opened.panel.dispose();
    }
  }

  private async handle(opened: OpenJudgePanel, message: JudgePanelMessage): Promise<void> {
    if (message.type === "judge") {
      await this.judge(opened);
      return;
    }
    if (message.type === "openLocation" && Number.isInteger(message.index)) {
      const location = opened.locations[message.index];
      if (location) {
        const line = new vscode.Position(location.line - 1, 0);
        await vscode.window.showTextDocument(uriOfTarget({ folderUri: opened.target.folderUri, path: location.path }), { selection: new vscode.Range(line, line), viewColumn: vscode.ViewColumn.Beside });
      }
    }
  }

  private async judge(opened: OpenJudgePanel): Promise<void> {
    if (opened.work === "judging") {
      return;
    }
    const { item, report } = this.measured(opened.target);
    opened.work = "judging";
    opened.error = undefined;
    this.render(opened);
    try {
      await this.judges.judge(vscode.Uri.parse(opened.target.folderUri).fsPath, item, report);
    } catch (error) {
      opened.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      opened.work = "idle";
      this.render(opened);
    }
  }

  private measured(target: CodemapTarget) {
    const state = this.godFiles.stateOf(target.folderUri);
    if (state?.state !== "ready") {
      throw new Error("The god files of this folder are not measured yet. Refresh God Files first.");
    }
    const item = state.report.items.find((candidate) => candidate.path === target.path);
    if (!item) {
      throw new Error(`${target.path} is not among the measured files any more. Refresh God Files.`);
    }
    return { item, report: state.report };
  }

  private renderAll(): void {
    for (const opened of this.open.values()) {
      this.render(opened);
    }
  }

  private render(opened: OpenJudgePanel): void {
    if (opened.closed) {
      return;
    }
    const state = this.godFiles.stateOf(opened.target.folderUri);
    const item = state?.state === "ready" ? state.report.items.find((candidate) => candidate.path === opened.target.path) : undefined;
    if (state?.state !== "ready" || !item) {
      opened.panel.webview.html = `<!DOCTYPE html><html><body><p>${state?.state === "measuring" ? "Measuring god files…" : "This file is not among the measured god files. Refresh God Files."}</p></body></html>`;
      opened.locations = [];
      return;
    }
    const folder = vscode.Uri.parse(opened.target.folderUri).fsPath;
    const stored = this.judges.judgmentOf(folder, item.path, state.report.commit);
    const { html, locations } = renderJudgePanel(
      { item, commit: state.report.commit, stored, work: opened.work, error: opened.error },
      randomBytes(16).toString("hex"),
      opened.panel.webview.cspSource,
    );
    opened.panel.webview.html = html;
    opened.locations = locations;
  }
}

function keyOf(target: CodemapTarget): string {
  return `${target.folderUri}#${target.path}`;
}
