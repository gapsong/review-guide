import { runMochaSuite } from "../mochaSuite";

export function run(): Promise<void> {
  return runMochaSuite(__dirname);
}
