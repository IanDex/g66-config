import fs from "fs/promises";
import path from "path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyFileSafe(
  src: string,
  dest: string,
): Promise<void> {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

export async function writeFileSafe(
  filePath: string,
  content: Buffer,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

export async function readFileIfExists(
  filePath: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function removeDirRecursive(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export function normalizeRepoPath(rel: string): string {
  return rel.split(path.sep).join("/");
}
