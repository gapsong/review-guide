import * as assert from "assert";
import { buildReviewUnits } from "../../src/review/buildReviewUnits";
import { parseUnifiedDiff } from "../../src/review/unifiedDiff";
import { findTestWeakening } from "../../src/review/weakenedTests";

function weakeningOf(file: string, removed: string[], added: string[]): string | undefined {
  const diff = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed.length + 1} +1,${added.length + 1} @@`,
    " def test_pack():",
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
  const [unit] = buildReviewUnits(parseUnifiedDiff(diff)[0], { old: undefined, new: undefined });
  return findTestWeakening(unit);
}

describe("findTestWeakening", () => {
  it("finds a removed assertion", () => {
    assert.match(
      weakeningOf("tests/test_packing.py", ["    assert unpack(pack(codes)) == codes", "    x = 1"], ["    x = 2"])!,
      /removes an assertion/,
    );
    assert.match(weakeningOf("src/packing.test.ts", ["  expect(words).toEqual([1, 2]);"], [])!, /removes an assertion/);
  });

  it("does not flag an assertion that is only rewritten", () => {
    assert.strictEqual(
      weakeningOf("tests/test_packing.py", ["    assert unpack(pack(codes)) == codes"], ["    assert unpack(pack(codes, bits=3)) == codes"]),
      undefined,
    );
  });

  it("finds a looser tolerance, and knows that fewer decimal places are looser", () => {
    assert.match(
      weakeningOf("tests/test_quant.py", ["    torch.testing.assert_close(out, ref, atol=1e-5, rtol=0)"], ["    torch.testing.assert_close(out, ref, atol=1e-2, rtol=0)"])!,
      /loosens the tolerance atol from 0.00001 to 0.01/,
    );
    assert.match(
      weakeningOf("tests/test_quant.py", ["        self.assertAlmostEqual(a, b, places=6)"], ["        self.assertAlmostEqual(a, b, places=2)"])!,
      /places from 6 to 2/,
    );
    assert.strictEqual(
      weakeningOf("tests/test_quant.py", ["    assert_allclose(out, ref, atol=1e-3)"], ["    assert_allclose(out, ref, atol=1e-6)"]),
      undefined,
      "a tighter tolerance is fine",
    );
  });

  it("finds an added skip", () => {
    assert.match(weakeningOf("tests/test_kernels.py", [], ["@pytest.mark.skip(reason='flaky')"])!, /adds a skip/);
    assert.match(weakeningOf("tests/test_kernels.py", [], ["    pytest.skip('no GPU')"])!, /adds a skip/);
    assert.match(weakeningOf("src/pack.spec.ts", [], ["  it.skip('packs 3 bit codes', () => {"])!, /adds a skip/);
  });

  it("does not count a skip in a test file or test function the PR adds", () => {
    const newFile = `diff --git a/tests/test_cuda.py b/tests/test_cuda.py
new file mode 100644
--- /dev/null
+++ b/tests/test_cuda.py
@@ -0,0 +1,3 @@
+@pytest.mark.skipif(not torch.cuda.is_available(), reason="needs CUDA")
+def test_kernel():
+    assert kernel() == 1
`;
    const [unit] = buildReviewUnits(parseUnifiedDiff(newFile)[0], { old: [], new: [{ path: "test_kernel", kind: "function", startLine: 1, endLine: 3 }] });
    assert.strictEqual(findTestWeakening(unit), undefined);

    const newFunction = newFile.replace("new file mode 100644\n", "").replace("--- /dev/null", "--- a/tests/test_cuda.py");
    const [added] = buildReviewUnits(parseUnifiedDiff(newFunction)[0], { old: [], new: [{ path: "test_kernel", kind: "function", startLine: 1, endLine: 3 }] });
    assert.strictEqual(added.existedBefore, false);
    assert.strictEqual(findTestWeakening(added), undefined);
  });

  it("ignores source files: the rules are about the scoreboard", () => {
    assert.strictEqual(weakeningOf("src/packing.py", ["    assert bits in (2, 3, 4)"], []), undefined);
  });
});
