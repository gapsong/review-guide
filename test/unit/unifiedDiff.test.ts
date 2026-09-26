import * as assert from "assert";
import { parseUnifiedDiff } from "../../src/review/unifiedDiff";

const diff = `diff --git a/packing.py b/packing.py
index 1111111..2222222 100644
--- a/packing.py
+++ b/packing.py
@@ -1,4 +1,5 @@
 def pack_codes(codes):
-    return codes
+    words = codes.view()
+    return words
 
 def unpack_codes(words):
diff --git a/new_file.py b/new_file.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new_file.py
@@ -0,0 +1,2 @@
+x = 1
+y = 2
\\ No newline at end of file
diff --git a/old.py b/old.py
deleted file mode 100644
index 4444444..0000000
--- a/old.py
+++ /dev/null
@@ -1 +0,0 @@
-gone = True
diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(diff);

  it("finds every file with its status", () => {
    assert.deepStrictEqual(
      files.map((file) => [file.oldPath, file.newPath, file.status, file.isBinary]),
      [
        ["packing.py", "packing.py", "modified", false],
        ["new_file.py", "new_file.py", "added", false],
        ["old.py", "old.py", "deleted", false],
        ["a.txt", "b.txt", "renamed", false],
        ["logo.png", "logo.png", "modified", true],
      ],
    );
  });

  it("numbers old and new lines, and anchors removed lines in the new file", () => {
    const lines = files[0].hunks[0].lines;
    assert.deepStrictEqual(lines[0], { kind: "context", text: "def pack_codes(codes):", oldLine: 1, newLine: 1 });
    assert.deepStrictEqual(lines[1], { kind: "removed", text: "    return codes", oldLine: 2, newAnchor: 2 });
    assert.deepStrictEqual(lines[2], { kind: "added", text: "    words = codes.view()", newLine: 2 });
    assert.deepStrictEqual(lines[3], { kind: "added", text: "    return words", newLine: 3 });
    assert.deepStrictEqual(lines[5], { kind: "context", text: "def unpack_codes(words):", oldLine: 4, newLine: 5 });
  });

  it("ignores the 'no newline at end of file' marker", () => {
    assert.strictEqual(files[1].hunks[0].lines.length, 2);
  });
});
