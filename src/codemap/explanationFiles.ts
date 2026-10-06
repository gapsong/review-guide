// Where generated explanations live: one folder per repo path, inside the personal .codemap folder,
// with index.html as the page and its images and scripts next to it.
//   apps/api/main.py  ->  .codemap/explanations/apps/api/main.py/index.html

export const explanationsFolder = ".codemap/explanations";

export const explanationPageName = "index.html";

// Relative to the workspace folder, with "/" between parts.
export function explanationFolderOf(repoPath: string): string {
  return `${explanationsFolder}/${repoPath}`;
}

export function explanationPageOf(repoPath: string): string {
  return `${explanationFolderOf(repoPath)}/${explanationPageName}`;
}
