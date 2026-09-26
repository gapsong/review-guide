import { Checkout } from "../git/pullRequestCheckout";
import { readChangedFiles, writeFileSides } from "../git/pullRequestFiles";
import { buildReviewUnits, FileSymbols } from "./buildReviewUnits";
import { ReviewUnit } from "./reviewUnit";
import { FileDiff } from "./unifiedDiff";

export type SymbolReader = (checkout: Checkout, file: FileDiff) => Promise<FileSymbols>;

export interface LoadedPullRequest {
  checkout: Checkout;
  files: FileDiff[];
  units: ReviewUnit[];
}

export async function loadPullRequest(checkout: Checkout, readSymbols: SymbolReader): Promise<LoadedPullRequest> {
  const files = await readChangedFiles(checkout);
  await writeFileSides(checkout, files);
  const unitsPerFile = await Promise.all(
    files.map(async (file) => buildReviewUnits(file, await readSymbols(checkout, file))),
  );
  return { checkout, files, units: unitsPerFile.flat() };
}
