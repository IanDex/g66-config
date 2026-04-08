/**
 * Ramas donde no se permite push directo; el flujo debe ser rama de trabajo + PR.
 */
export const DIRECT_PUSH_FORBIDDEN_BRANCHES: readonly string[] = [
  "development",
  "master",
  "release",
  "main",
];

export function isDirectPushForbiddenBranch(branchName: string): boolean {
  const t = branchName.trim();
  return DIRECT_PUSH_FORBIDDEN_BRANCHES.some((b) => b === t);
}
