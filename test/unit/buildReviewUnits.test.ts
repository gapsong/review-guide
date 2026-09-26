import * as assert from "assert";
import { buildReviewUnits, CodeSymbol } from "../../src/review/buildReviewUnits";
import { unitTitle } from "../../src/review/reviewUnit";
import { parseUnifiedDiff } from "../../src/review/unifiedDiff";

// Old file:                          New file:
//  1 import torch                     1 import torch
//  2 SCALE = 1                        2 import numpy
//  3                                  3 SCALE = 2
//  4 def pack(codes):                 4
//  5     a = codes                    5 def pack(codes):
//  6     return a                     6     a = codes + 1
//  7                                  7     return a
//  8 def unpack(words):               8
//  9     return words                 9 def unpack(words):
//                                    10     return words * 2
const diff = `diff --git a/packing.py b/packing.py
--- a/packing.py
+++ b/packing.py
@@ -1,9 +1,10 @@
 import torch
-SCALE = 1
+import numpy
+SCALE = 2
 
 def pack(codes):
-    a = codes
+    a = codes + 1
     return a
 
 def unpack(words):
-    return words
+    return words * 2
`;

const oldSymbols: CodeSymbol[] = [
  { path: "pack", kind: "function", startLine: 4, endLine: 6 },
  { path: "unpack", kind: "function", startLine: 8, endLine: 9 },
];
const newSymbols: CodeSymbol[] = [
  { path: "pack", kind: "function", startLine: 5, endLine: 7 },
  { path: "unpack", kind: "function", startLine: 9, endLine: 10 },
];

describe("buildReviewUnits", () => {
  const [file] = parseUnifiedDiff(diff);

  it("splits one hunk into one unit per function plus one for changes outside functions", () => {
    const units = buildReviewUnits(file, { old: oldSymbols, new: newSymbols });
    assert.deepStrictEqual(units.map(unitTitle), ["(outside functions)", "pack()", "unpack()"]);
    assert.deepStrictEqual(units.map((unit) => unit.newRange), [
      { start: 2, end: 3 },
      { start: 6, end: 6 },
      { start: 10, end: 10 },
    ]);
  });

  it("shows only the unit's own changes, with unchanged lines around them", () => {
    const pack = buildReviewUnits(file, { old: oldSymbols, new: newSymbols })[1];
    assert.deepStrictEqual(pack.lines.map((line) => line.kind + ":" + line.text), [
      "context:",
      "context:def pack(codes):",
      "removed:    a = codes",
      "added:    a = codes + 1",
      "context:    return a",
      "context:",
      "context:def unpack(words):",
    ]);
  });

  it("merges hunks that lie in the same function", () => {
    const twoHunks = `diff --git a/m.py b/m.py
--- a/m.py
+++ b/m.py
@@ -2,1 +2,1 @@
-    a = 1
+    a = 2
@@ -40,1 +40,1 @@
-    b = 1
+    b = 2
`;
    const symbols: CodeSymbol[] = [{ path: "Model.forward", kind: "function", startLine: 1, endLine: 50 }];
    const units = buildReviewUnits(parseUnifiedDiff(twoHunks)[0], { old: symbols, new: symbols });
    assert.deepStrictEqual(units.map(unitTitle), ["Model.forward()"]);
    assert.deepStrictEqual(units[0].newRange, { start: 2, end: 40 });
  });

  it("uses the innermost symbol, so a method is its own unit inside its class", () => {
    const symbols: CodeSymbol[] = [
      { path: "QuantLinear", kind: "class", startLine: 1, endLine: 20 },
      { path: "QuantLinear.merge", kind: "function", startLine: 5, endLine: 9 },
    ];
    const units = buildReviewUnits(parseUnifiedDiff(`diff --git a/t.py b/t.py
--- a/t.py
+++ b/t.py
@@ -2,1 +2,1 @@
-    bits = 3
+    bits = 4
@@ -6,1 +6,1 @@
-        return w
+        return w + z
`)[0], { old: symbols, new: symbols });
    assert.deepStrictEqual(units.map(unitTitle), ["class QuantLinear", "QuantLinear.merge()"]);
  });

  it("falls back to raw git hunks when a file has no symbol provider", () => {
    const units = buildReviewUnits(file, { old: undefined, new: undefined });
    assert.deepStrictEqual(units.map(unitTitle), ["lines 2-10"]);
  });

  it("gives a removed function a unit that points at where it used to be", () => {
    const removal = `diff --git a/r.py b/r.py
--- a/r.py
+++ b/r.py
@@ -1,4 +1,1 @@
 x = 1
-def old():
-    return 1
-
`;
    const units = buildReviewUnits(parseUnifiedDiff(removal)[0], {
      old: [{ path: "old", kind: "function", startLine: 2, endLine: 3 }],
      new: [],
    });
    assert.deepStrictEqual(units.map(unitTitle), ["old()"]);
    assert.deepStrictEqual(units[0].newRange, { start: 2, end: 2 });
  });

  it("keeps the id stable and changes the hash only when the unit's change changes", () => {
    const before = buildReviewUnits(file, { old: oldSymbols, new: newSymbols });
    const edited = diff.replace("+    return words * 2", "+    return words * 3");
    const after = buildReviewUnits(parseUnifiedDiff(edited)[0], { old: oldSymbols, new: newSymbols });
    assert.deepStrictEqual(after.map((unit) => unit.id), before.map((unit) => unit.id));
    assert.strictEqual(after[1].hash, before[1].hash, "pack() did not change");
    assert.notStrictEqual(after[2].hash, before[2].hash, "unpack() changed");
  });

  it("does not make a unit of blank lines added between functions", () => {
    const blank = `diff --git a/b.py b/b.py
--- a/b.py
+++ b/b.py
@@ -1,2 +1,5 @@
 def a():
     return 1
+
+def b():
+    return 2
`;
    const units = buildReviewUnits(parseUnifiedDiff(blank)[0], {
      old: [{ path: "a", kind: "function", startLine: 1, endLine: 2 }],
      new: [
        { path: "a", kind: "function", startLine: 1, endLine: 2 },
        { path: "b", kind: "function", startLine: 4, endLine: 5 },
      ],
    });
    assert.deepStrictEqual(units.map(unitTitle), ["b()"]);
  });

  it("marks units in test files", () => {
    const testDiff = diff.replace(/packing\.py/g, "tests/test_packing.py");
    const units = buildReviewUnits(parseUnifiedDiff(testDiff)[0], { old: oldSymbols, new: newSymbols });
    assert.ok(units.every((unit) => unit.isTestFile));
  });
});
