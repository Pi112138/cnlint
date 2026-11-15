/**
 * 自动修复器。
 *
 * 设计原则：只修复「答案唯一」的问题，其余保持原样交给人工处理。
 */

import { splitLines, markFencedCodeLines, inlineCodeRanges, inRanges, classifyLine, isSkippedKind } from './text.js';
import { rules, defaultRuleLevels } from './rules.js';

/**
 * 对一行文本应用该行所有可修复的问题。
 *
 * 关键：必须从右向左替换，否则前面的替换会改变后面问题的列偏移。
 *
 * @param {string} line
 * @param {Array} issues 该行的问题列表（含 column / length / suggestion / fixable）
 * @returns {string}
 */
export function fixLine(line, issues) {
  const applicable = issues
    .filter((i) => i.fixable)
    .slice()
    // 从右往左，同一位置时先处理更长的片段
    .sort((a, b) => (b.column - a.column) || (b.length - a.length));

  let result = line;
  let lastStart = Infinity;

  for (const issue of applicable) {
    const start = issue.column - 1;
    const end = start + issue.length;

    // 跳过与前一次替换区间重叠的问题，避免破坏文本
    if (end > lastStart) continue;
    // 越界保护
    if (start < 0 || end > result.length) continue;

    result = result.slice(0, start) + issue.suggestion + result.slice(end);
    lastStart = start;
  }

  return result;
}

/**
 * 检查并修复一段文本。
 *
 * @param {string} text
 * @param {object} options
 * @param {Record<string,string|false>} options.levels
 * @returns {{
 *   output: string,
 *   fixed: Array,        // 已修复的问题
 *   remaining: Array     // 仍需人工处理的问题
 * }}
 */
export function fixText(text, options = {}) {
  const levels = options.levels ?? defaultRuleLevels;
  const lines = splitLines(text);
  const skipLines = markFencedCodeLines(lines);
  const active = rules.filter((r) => levels[r.id]);

  const fixed = [];
  const remaining = [];
  const outLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (skipLines[i]) {
      outLines.push(line);
      continue;
    }

    // Markdown 结构感知：与检查器保持一致
    const info = classifyLine(line);
    if (isSkippedKind(info.kind)) {
      outLines.push(line);
      continue;
    }

    const inline = inlineCodeRanges(line);
    const skippedRanges = [...inline, ...info.markers];
    const ctx = { isSkipped: (col) => inRanges(col, skippedRanges) };

    const lineIssues = [];
    for (const rule of active) {
      for (const issue of rule.check(line, ctx)) {
        lineIssues.push({ ...issue, severity: levels[rule.id], line: i + 1 });
      }
    }

    if (lineIssues.length === 0) {
      outLines.push(line);
      continue;
    }

    const fixable = lineIssues.filter((iss) => iss.fixable);
    const manual = lineIssues.filter((iss) => !iss.fixable);

    if (fixable.length === 0) {
      outLines.push(line);
      remaining.push(...manual);
      continue;
    }

    const fixedLine = fixLine(line, lineIssues);
    outLines.push(fixedLine);

    // 记录真正被改动的那些
    fixed.push(...fixable);
    remaining.push(...manual);
  }

  // 保留原始换行风格：原文本使用 CRLF 则输出 CRLF
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const trailing = text.endsWith('\n') || text.endsWith('\r\n');
  const output = outLines.join(eol) + (trailing ? eol : '');

  return { output, fixed, remaining };
}

/**
 * 判断修复后内容是否真的发生了变化。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function hasChanged(a, b) {
  return a !== b;
}