import * as assert from "assert";
import { CodemapEntry, CodemapLabel } from "../../src/codemap/codemap";
import { buildCodemapTree, CodemapFilter, CodemapTreeNode } from "../../src/codemap/codemapTree";

function entry(path: string, label: CodemapLabel, deep = false): CodemapEntry {
  return { path, says: `About ${path}.`, label, deep };
}

const shop = [
  entry("shop", "core"),
  entry("shop/checkout/payment.py", "money", true),
  entry("shop/billing/discounts.py", "money"),
  entry("shop/auth/session.py", "security", true),
  entry("shop/auth/passwords.py", "security"),
  entry("shop/search", "feature", true),
  entry("shop/app.py", "util"),
  entry("docs/guides/setup/install.md", "util"),
];

const folders = new Set(["shop", "shop/search"]);

// One line per node, indented by depth: "+" marks an entry, "/" at the end a folder.
function outline(nodes: CodemapTreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${"  ".repeat(depth)}${node.entry ? "+ " : ""}${node.name}${node.isFolder ? "/" : ""}`,
    ...outline(node.children, depth + 1),
  ]);
}

function treeOf(entries: CodemapEntry[], filter: CodemapFilter = "all"): string[] {
  return outline(buildCodemapTree(entries, filter, (path) => folders.has(path)));
}

describe("the Codemap view's tree", () => {
  it("adds plain folders on the way to entries, compacts plain chains, and lists folders first, by name", () => {
    assert.deepStrictEqual(treeOf(shop), [
      "docs/guides/setup/",
      "  + install.md",
      "+ shop/",
      "  auth/",
      "    + passwords.py",
      "    + session.py",
      "  billing/",
      "    + discounts.py",
      "  checkout/",
      "    + payment.py",
      "  + search/",
      "  + app.py",
    ]);
  });

  it("names a compacted chain by all its folders, and never merges an entry into it", () => {
    const tree = buildCodemapTree([entry("src/app/main/server.ts", "core"), entry("src/app/main/client", "feature")], "all", () => false);
    assert.strictEqual(tree.length, 1);
    assert.strictEqual(tree[0].name, "src/app/main");
    assert.strictEqual(tree[0].path, "src/app/main");
    assert.strictEqual(tree[0].entry, undefined);
    assert.deepStrictEqual(tree[0].children.map((node) => node.name), ["client", "server.ts"]);
  });

  it("does not compact a folder with more than one child, or an entry's folder", () => {
    assert.deepStrictEqual(treeOf([entry("a", "core"), entry("a/b/c.py", "util")]), ["+ a/", "  b/", "    + c.py"]);
    assert.deepStrictEqual(treeOf([entry("a/b.py", "util"), entry("a/c.py", "util")]), ["a/", "  + b.py", "  + c.py"]);
  });

  it("filters to money, security or deep modules, keeping only matching entries and their folders", () => {
    assert.deepStrictEqual(treeOf(shop, "money"), [
      "shop/",
      "  billing/",
      "    + discounts.py",
      "  checkout/",
      "    + payment.py",
    ]);
    assert.deepStrictEqual(treeOf(shop, "security"), ["shop/auth/", "  + passwords.py", "  + session.py"]);
    assert.deepStrictEqual(treeOf(shop, "deep"), [
      "shop/",
      "  auth/",
      "    + session.py",
      "  checkout/",
      "    + payment.py",
      "  + search/",
    ]);
  });

  it("C13: filters to entries that are not owned yet, keeping the folders on their way", () => {
    const owned = new Set(["shop", "shop/checkout/payment.py", "shop/auth/passwords.py", "shop/search", "shop/app.py", "docs/guides/setup/install.md"]);
    const tree = buildCodemapTree(shop, "unowned", (path) => folders.has(path), (candidate) => owned.has(candidate.path));
    assert.deepStrictEqual(outline(tree), [
      "shop/",
      "  auth/",
      "    + session.py",
      "  billing/",
      "    + discounts.py",
    ]);
    assert.strictEqual(tree[0].entry, undefined, "an owned entry on the way is a plain folder");
    assert.deepStrictEqual(buildCodemapTree(shop, "unowned", () => false, () => true), [], "nothing left when all are owned");
  });

  it("shows an entry that does not match the filter, but holds one that does, as a plain folder", () => {
    const tree = buildCodemapTree(shop, "money", (path) => folders.has(path));
    assert.strictEqual(tree[0].path, "shop");
    assert.strictEqual(tree[0].entry, undefined);
  });

  it("is empty without entries, or when nothing matches", () => {
    assert.deepStrictEqual(buildCodemapTree([], "all", () => false), []);
    assert.deepStrictEqual(buildCodemapTree([entry("a.py", "util")], "deep", () => false), []);
  });

  it("sorts names like the Explorer: case does not matter, numbers by value", () => {
    const names = ["b10.py", "B2.py", "a.py"].map((name) => entry(name, "util"));
    assert.deepStrictEqual(treeOf(names), ["+ a.py", "+ B2.py", "+ b10.py"]);
  });
});
