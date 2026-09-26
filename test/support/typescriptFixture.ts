import type { FileTree } from "./gitFixture";

// A small TypeScript project: VS Code's built-in TypeScript support gives document symbols for it,
// so units are real functions in the integration tests.
export const baseFiles: FileTree = {
  "src/packing.ts": `export const bitsPerWord = 32;

export function packCodes(codes: number[], bits: number): number[] {
  const words: number[] = [];
  for (const code of codes) {
    words.push(code);
  }
  return words;
}

export function unpackCodes(words: number[], bits: number): number[] {
  return words.map((word) => word & ((1 << bits) - 1));
}
`,
  "README.md": "# Packing\n\nPacks codes into words.\n",
};

export const headFiles: FileTree = {
  "src/packing.ts": `export const bitsPerWord = 32;

export function packCodes(codes: number[], bits: number): number[] {
  const words: number[] = [];
  let shift = 0;
  for (const code of codes) {
    words.push(code << shift);
    shift = (shift + bits) % bitsPerWord;
  }
  return words;
}

export function unpackCodes(words: number[], bits: number): number[] {
  return words.map((word) => (word >>> 0) & ((1 << bits) - 1));
}

export function codesPerWord(bits: number): number {
  return Math.floor(bitsPerWord / bits);
}
`,
  "README.md": "# Packing\n\nPacks 2, 3 and 4 bit codes into 32 bit words.\n",
};
