import { UnitRecord } from "./reviewState";

export interface FileOwnership {
  file: string;
  understood: number;
  critical: number;
}

// Per file of a repo: how many of its critical units the reviewer has understood, across all PRs reviewed.
export function ownershipByFile(records: UnitRecord[]): FileOwnership[] {
  const byFile = new Map<string, FileOwnership>();
  for (const record of records.filter((candidate) => candidate.tier === "critical")) {
    const entry = byFile.get(record.file) ?? { file: record.file, understood: 0, critical: 0 };
    entry.critical += 1;
    entry.understood += record.state === "understood" ? 1 : 0;
    byFile.set(record.file, entry);
  }
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

export interface ThreeAmCheck {
  understood: number;
  read: number;
  unread: number;
  // True only when every critical unit is understood.
  owned: boolean;
}

// Osmani's 3am check for one PR: could the reviewer debug each critical unit at 3am? Reading is not enough.
export function threeAmCheck(criticalRecords: (UnitRecord | undefined)[]): ThreeAmCheck {
  const count = (state: UnitRecord["state"]) =>
    criticalRecords.filter((record) => (record?.state ?? "unread") === state).length;
  const understood = count("understood");
  return { understood, read: count("read"), unread: count("unread"), owned: understood === criticalRecords.length };
}

export function describeThreeAmCheck(check: ThreeAmCheck): string {
  if (check.owned) {
    return check.understood === 0 ? "3am: owned (no critical units)" : "3am: owned";
  }
  return `3am: ${check.understood} understood · ${check.read} read · ${check.unread} unread`;
}
