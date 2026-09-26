import * as fs from "fs";
import * as path from "path";
import Mocha from "mocha";

export function runMochaSuite(suiteDirectory: string): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true, timeout: 120_000 });
  for (const file of fs.readdirSync(suiteDirectory)) {
    if (file.endsWith(".test.js")) {
      mocha.addFile(path.join(suiteDirectory, file));
    }
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}
