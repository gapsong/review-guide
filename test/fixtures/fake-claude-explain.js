#!/usr/bin/env node
// Stands in for `claude` when the Explain panel's button starts it in a terminal: it writes the page
// Claude would write, and keeps the prompt it got, so a test can check that the prompt arrived as
// one argument, byte for byte.
const fs = require("fs");
const path = require("path");

const prompt = process.argv[2] ?? "";
const outputFolder = prompt.match(/^Output folder: (.+)$/m)[1];
fs.mkdirSync(outputFolder, { recursive: true });
fs.writeFileSync(path.join(outputFolder, "prompt.txt"), prompt);
fs.writeFileSync(
  path.join(outputFolder, "index.html"),
  `<!DOCTYPE html>\n<html>\n<head><title>Fake</title></head>\n<body>\n<h1>Fake explanation</h1>\n<p>${process.argv.length - 2} argument(s)</p>\n</body>\n</html>\n`,
);
