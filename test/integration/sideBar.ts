import type { ReviewGuideApi } from "../../src/extension";
import type { PullRequestTreeNode } from "../../src/ui/pullRequestTree";

// Walks the side bar like a person would: first repo, first PR, then its groups and units.
export async function findUnitNode(api: ReviewGuideApi, title: string): Promise<PullRequestTreeNode> {
  const tree = api.pullRequestTree;
  for (const group of await tree.getChildren(await firstPullRequestNode(api))) {
    for (const node of await tree.getChildren(group)) {
      if (node.kind === "unit" && String(tree.getTreeItem(node).label).endsWith(`  ${title}`)) {
        return node;
      }
    }
  }
  throw new Error(`No unit ${title} in the side bar`);
}

export async function firstPullRequestNode(api: ReviewGuideApi): Promise<PullRequestTreeNode> {
  const tree = api.pullRequestTree;
  return (await tree.getChildren((await tree.getChildren())[0]))[0];
}
