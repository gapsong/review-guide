import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { folderKey } from "../git/headCopy";
import { GodFileOptions, GodFileReport } from "./godFiles";

// Reports in the extension's storage, one per repo, HEAD commit and settings: a report belongs to
// exactly one commit (godFiles.ts), so it is measured once per commit and never written into the repo.
//
//   storage/god-files/<folder hash>/<commit>-<settings hash>.json

const reportsKeptPerRepo = 4;

export class GodFileReportCache {
  constructor(private readonly storageFolder: string) {}

  reportOf(repoFolder: string, commit: string, options: GodFileOptions): GodFileReport | undefined {
    const file = this.fileOf(repoFolder, commit, options);
    if (!fs.existsSync(file)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as GodFileReport;
  }

  save(repoFolder: string, report: GodFileReport, options: GodFileOptions): void {
    const file = this.fileOf(repoFolder, report.commit, options);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const unfinished = `${file}.${process.pid}.partial`;
    fs.writeFileSync(unfinished, JSON.stringify(report));
    fs.renameSync(unfinished, file);
    this.removeOlderReports(path.dirname(file));
  }

  private fileOf(repoFolder: string, commit: string, options: GodFileOptions): string {
    return path.join(this.storageFolder, folderKey(repoFolder), `${commit}-${settingsKeyOf(options)}.json`);
  }

  private removeOlderReports(folder: string): void {
    const reports = fs.readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(folder, name))
      .sort((first, second) => fs.statSync(second).mtimeMs - fs.statSync(first).mtimeMs);
    for (const old of reports.slice(reportsKeptPerRepo)) {
      fs.rmSync(old, { force: true });
    }
  }
}

function settingsKeyOf(options: GodFileOptions): string {
  const settings = { days: options.days, minCodeLines: options.minCodeLines, exclude: options.exclude };
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 12);
}
