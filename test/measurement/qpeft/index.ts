import { runMochaSuite } from "../../integration/mochaSuite";

export function run(): Promise<void> {
  return runMochaSuite(__dirname);
}
