/**
 * 单文件 / 多文件检查器。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitLines, markFencedCodeLines, inlineCodeRanges, inRanges } from './text.js';
import { rules, defaultRuleLevels } from './rules.js';

/**
 * 归一化 .cnlintrc.json 的配置。
 * @param {object} raw
 * @returns {{ levels: Record<string,string|false>, ignore: string[] }}
 */
export function normalizeConfig(raw = {}) {
  const levels = { ...defaultRuleLevels };

  const userRules = raw.rules ?? {};
  for (const [id, level] of Object.entries(userRules)) {
    if (!(id in defaultRuleLevels)) {
      throw new Error(`未知规则：${id}（可用规则：${Object.keys(defaultRuleLevels).join(', ')}）`);
    }
    if (level !== 'error' && level !== 'warn' && level !== 'off' && level !== false) {
      throw new Error(`规则 ${id} 的级别无效：${level}（应为 error / warn / off）`);
    }
    levels[id] = level === 'off' || level === false ? false : level;
  }

  const ignore = Array.isArray(raw.ignore) ? raw.ignore : [];
  return { levels, ignore };
}

/**
 * 极简 glob 匹配：支持 **、*、?。
 * 用于 ignore 配置，避免为最小实现引入依赖。
 *
 * @param {string} pattern 例如 node_modules/**
 * @param {string} relPath 使用 / 分隔的相对路径
 * @returns {boolean}
 */
export function matchGlob(pattern, relPath) {
  const norm = relPath.split(path.sep).join('/');
  const escaped = pattern
    .split('/')
    .map((seg) => {
      if (seg === '**') return '.*';
      const s = seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      return s;
    })
    .join('/')
    .replace(/\/\.\*/g, '(?:/.*)?');

  return new RegExp(`^${escaped}$`).test(norm);
}

/**
 * 检查一段文本。
 *
 * @param {string} text 文件内容
 * @param {object} options
 * @param {Record<string,string|false>} options.levels 各规则级别
 * @returns {Array} 问题列表（不含文件路径）
 */
export function lintText(text, options = {}) {
  const levels = options.levels ?? defaultRuleLevels;
  const lines = splitLines(text);
  const skipLines = markFencedCodeLines(lines);
  const active = rules.filter((r) => levels[r.id]);

  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    if (skipLines[i]) continue;
    const line = lines[i];
    const inline = inlineCodeRanges(line);
    const ctx = {
      isSkipped: (col) => inRanges(col, inline),
    };

    for (const rule of active) {
      for (const issue of rule.check(line, ctx)) {
        issues.push({
          ...issue,
          severity: levels[rule.id],
          line: i + 1,
        });
      }
    }
  }

  return issues;
}

/**
 * 检查单个文件。
 *
 * @param {string} filePath 绝对或相对路径
 * @param {object} options
 * @param {Record<string,string|false>} options.levels
 * @returns {Promise<{file: string, issues: Array, error?: string}>}
 */
export async function lintFile(filePath, options = {}) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    return { file: filePath, issues: [], error: `无法读取文件：${err.message}` };
  }

  return { file: filePath, issues: lintText(text, options) };
}