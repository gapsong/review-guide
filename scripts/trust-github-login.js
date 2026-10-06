const fs = require("fs");
const path = require("path");

const extensionId = "gapsong.review-guide";

// Stands in for the one click a person makes the first time: "Allow Review Guide to sign in
// using GitHub". VS Code keeps that answer in its storage, but test runs use in-memory storage,
// so it cannot be stored ahead. VS Code's product.json has a list of extensions that are trusted
// for a login provider without asking; the downloaded test copy of VS Code gets this extension on it.
function trustExtensionForGitHubLogin(vscodeExecutablePath) {
  const productPath = findProductJson(vscodeExecutablePath);
  const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
  const trusted = product.trustedExtensionAuthAccess ?? {};
  const githubTrusted = trusted.github ?? [];
  if (!githubTrusted.includes(extensionId)) {
    trusted.github = [...githubTrusted, extensionId];
    product.trustedExtensionAuthAccess = trusted;
    fs.writeFileSync(productPath, JSON.stringify(product, null, "\t"));
  }
}

// On macOS the executable sits in Code.app/Contents/MacOS and the app files in Contents/Resources;
// on Linux and Windows both sit in the same folder.
function findProductJson(vscodeExecutablePath) {
  const executableFolder = path.dirname(vscodeExecutablePath);
  const resources = process.platform === "darwin"
    ? path.join(executableFolder, "..", "Resources")
    : path.join(executableFolder, "resources");
  return path.join(resources, "app", "product.json");
}

module.exports = { trustExtensionForGitHubLogin };
