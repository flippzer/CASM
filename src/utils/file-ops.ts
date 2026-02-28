import fsExtra from 'fs-extra';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const { readFile, writeFile, ensureDir: fsEnsureDir } = fsExtra;

export async function readFileContent(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await fsEnsureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fsEnsureDir(dirPath);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fsEnsureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export async function listFiles(pattern: string, cwd: string): Promise<string[]> {
  // Simple recursive directory listing with basic glob matching
  // Supports patterns like "*.ts", "**/*.ts"
  const regex = globToRegex(pattern);
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(cwd, full);
      if (entry.isDirectory()) {
        walk(full);
      } else if (regex.test(rel)) {
        results.push(rel);
      }
    }
  }

  walk(cwd);
  return results;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}
