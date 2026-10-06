import { CodemapEntry } from "./codemap";

// The tree of the Codemap view, built from the codemap entries alone. Pure, so it can be tested
// without VS Code.
//
//   entries                          tree
//   shop/checkout/payment.py   ->    shop/checkout        (a plain folder: on the way, not an entry)
//   shop/auth/session.py                 💰 payment.py
//                                    shop/auth
//                                        🔒 session.py
//
// A chain of plain folders with one child each is shown as one node, as VS Code's Explorer does.

export const codemapFilters = ["all", "money", "security", "deep"] as const;
export type CodemapFilter = (typeof codemapFilters)[number];

export interface CodemapTreeNode {
  // The repo path of the entry, or of the last folder of a compacted chain.
  path: string;
  // What the tree shows: a file or folder name, or a compacted chain of folders like "src/app".
  name: string;
  // Undefined for a plain folder: one that is only on the way to entries.
  entry: CodemapEntry | undefined;
  isFolder: boolean;
  children: CodemapTreeNode[];
}

// isFolder tells whether an entry with nothing listed below it is a folder; a path that does not
// exist counts as a file.
export function buildCodemapTree(entries: CodemapEntry[], filter: CodemapFilter, isFolder: (repoPath: string) => boolean): CodemapTreeNode[] {
  const root = newNode("", "");
  for (const entry of entries) {
    if (matchesFilter(entry, filter)) {
      addEntry(root, entry);
    }
  }
  markFolders(root, isFolder);
  return sortedByName(root.children.map(compacted));
}

export function matchesFilter(entry: CodemapEntry, filter: CodemapFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "money":
      return entry.label === "money";
    case "security":
      return entry.label === "security";
    case "deep":
      return entry.deep;
  }
}

function addEntry(root: CodemapTreeNode, entry: CodemapEntry): void {
  let node = root;
  for (const name of entry.path.split("/")) {
    const path = node.path === "" ? name : `${node.path}/${name}`;
    let child = node.children.find((candidate) => candidate.name === name);
    if (!child) {
      child = newNode(path, name);
      node.children.push(child);
    }
    node = child;
  }
  node.entry = entry;
}

function markFolders(node: CodemapTreeNode, isFolder: (repoPath: string) => boolean): void {
  for (const child of node.children) {
    markFolders(child, isFolder);
  }
  node.isFolder = node.children.length > 0 || isFolder(node.path);
}

// Only plain folders are merged: an entry always keeps a node of its own, with its own name.
function compacted(node: CodemapTreeNode): CodemapTreeNode {
  let current = node;
  while (current.entry === undefined && current.children.length === 1 && current.children[0].entry === undefined) {
    const child = current.children[0];
    current = { ...child, name: `${current.name}/${child.name}` };
  }
  return { ...current, children: sortedByName(current.children.map(compacted)) };
}

// Like the Explorer: folders first, then files, each by name.
function sortedByName(nodes: CodemapTreeNode[]): CodemapTreeNode[] {
  return [...nodes].sort((first, second) => {
    if (first.isFolder !== second.isFolder) {
      return first.isFolder ? -1 : 1;
    }
    return first.name.localeCompare(second.name, "en", { numeric: true, sensitivity: "base" });
  });
}

function newNode(path: string, name: string): CodemapTreeNode {
  return { path, name, entry: undefined, isFolder: false, children: [] };
}
