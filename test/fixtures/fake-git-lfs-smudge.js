#!/usr/bin/env node
// A stand-in for "git lfs smudge" in the HEAD copy test. The real one turns a pointer file into
// the large file, fetching it over the network into the repo's .git/lfs when it is not there yet.
// This one writes a marker into .git/lfs instead, unless GIT_LFS_SKIP_SMUDGE is set, when it
// leaves the pointer as it is, as the real one does.
const fs = require("fs");
const path = require("path");

const pointer = fs.readFileSync(0, "utf8");
if (process.env.GIT_LFS_SKIP_SMUDGE === "1") {
  process.stdout.write(pointer);
} else {
  const fetched = path.join(process.cwd(), ".git", "lfs", "objects", "fetched");
  fs.mkdirSync(path.dirname(fetched), { recursive: true });
  fs.writeFileSync(fetched, "downloaded\n");
  process.stdout.write("the large file, fetched over the network\n");
}
