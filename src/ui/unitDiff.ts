import * as vscode from "vscode";
import { fileSides } from "../git/pullRequestFiles";
import { PullRequestReview } from "../review/pullRequestReview";
import { ReviewUnit, unitTitle } from "../review/reviewUnit";

// Opens the diff (base vs head) of the unit's file, scrolled to the unit.
export async function showUnitDiff(review: PullRequestReview, unit: ReviewUnit): Promise<void> {
  const file = review.files.find((candidate) => candidate.newPath === unit.file || candidate.oldPath === unit.file);
  if (!file) {
    throw new Error(`${unit.file} is not part of the pull request`);
  }
  const sides = fileSides(review.checkout, file);
  const selection = new vscode.Range(unit.newRange.start - 1, 0, unit.newRange.end - 1, 0);
  await vscode.commands.executeCommand(
    "vscode.diff",
    vscode.Uri.file(sides.basePath),
    vscode.Uri.file(sides.headPath),
    `${unit.file}: ${unitTitle(unit)} (PR #${review.pullRequest.number})`,
    { selection, preview: true, preserveFocus: false } satisfies vscode.TextDocumentShowOptions,
  );
}
