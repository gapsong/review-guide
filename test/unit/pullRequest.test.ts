import * as assert from "assert";
import { parseRepo, repoFromRemoteUrl } from "../../src/github/pullRequest";

describe("repo names", () => {
  it("reads owner/name from the setting", () => {
    assert.deepStrictEqual(parseRepo(" gapsong/qpeft "), { owner: "gapsong", name: "qpeft" });
    assert.strictEqual(parseRepo("not a repo"), undefined);
  });

  it("reads the repo from the usual GitHub remote urls", () => {
    const expected = { owner: "gapsong", name: "qpeft" };
    assert.deepStrictEqual(repoFromRemoteUrl("https://github.com/gapsong/qpeft.git"), expected);
    assert.deepStrictEqual(repoFromRemoteUrl("https://github.com/gapsong/qpeft"), expected);
    assert.deepStrictEqual(repoFromRemoteUrl("git@github.com:gapsong/qpeft.git\n"), expected);
    assert.deepStrictEqual(repoFromRemoteUrl("ssh://git@github.com/gapsong/qpeft"), expected);
    assert.strictEqual(repoFromRemoteUrl("https://gitlab.com/gapsong/qpeft.git"), undefined);
  });
});
