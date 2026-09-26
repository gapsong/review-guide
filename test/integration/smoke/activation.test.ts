import * as assert from "assert";
import * as vscode from "vscode";

describe("extension activation", () => {
  it("activates in a real VS Code", async () => {
    const extension = vscode.extensions.getExtension("gapsong.review-guide");
    assert.ok(extension, "extension is installed");
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });
});
