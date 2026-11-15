/**
 * 文件发现、配置加载、忽略规则。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeConfig, matchGlob } from './linter.js';

export const DEFAULT_EXTENSIONS = ['.md', '.txt'];

/**
 * 递归收集目录下的文件，按扩展名过滤。
 *
 * @param {string} rootDir
 * @param {string[]} extensions 形如 ['.md', '.txt']
 * @param {object} options
 * @param {string[]} options.ignore 相对 rootDir 的 glob
 * @returns {Promise<string[]>} 相对 rootDir 的路径列表
 */
export async function collectFiles(rootDir, extensions, options = {}) {
  const exts = extensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
  const ignore = options.ignore ?? [];
  const out = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(rootDir, abs).split(path.sep).join('/');

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        if (ignore.some((g) => matchGlob(g, rel) || matchGlob(g, `${rel}/`))) continue;
        await walk(abs);
      } else if (entry.isFile()) {
        if (ignore.some((g) => matchGlob(g, rel))) continue;
        if (!exts.includes(path.extname(entry.name).toLowerCase())) continue;
        out.push(rel);
      }
    }
  }

  await walk(rootDir);
  out.sort();
  return out;
}

/**
 * 从 fromDir 向上查找 .cnlintrc.json。
 * @param {string} fromDir
 * @returns {Promise<{configDir: string, raw: object}|null>}
 */
export async function findConfig(fromDir) {
  let dir = path.resolve(fromDir);

  for (;;) {
    const candidate = path.join(dir, '.cnlintrc.json');
    try {
      // 去掉可能存在的 BOM（Windows 记事本 / PowerShell 会写入）
      const text = (await readFile(candidate, 'utf8')).replace(/^\uFEFF/, '');
      return { configDir: dir, raw: JSON.parse(text) };
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`${candidate} 不是合法 JSON：${err.message}`);
      }
      // 不存在则继续向上
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 加载配置；不存在时返回默认配置。
 * @param {string} fromDir
 * @returns {Promise<{configDir: string|null, levels: object, ignore: string[]}>}
 */
export async function loadConfig(fromDir) {
  const found = await findConfig(fromDir);
  if (!found) {
    const normalized = normalizeConfig({});
    return { configDir: null, ...normalized };
  }
  const normalized = normalizeConfig(found.raw);
  return { configDir: found.configDir, ...normalized };
}

/**
 * 读取 git 暂存区中的文件列表，并按扩展名过滤。
 * @param {string} cwd
 * @param {string[]} extensions
 * @returns {string[]}
 */
export function stagedFiles(cwd, extensions) {
  const exts = extensions.map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
  const stdout = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { cwd, encoding: 'utf8' },
  );
  return stdout
    .split(/\r\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => exts.includes(path.extname(p).toLowerCase()));
}

/**
 * 判断路径是否为目录。
 * @param {string} p
 * @returns {Promise<boolean>}
 */
export async function isDirectory(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}