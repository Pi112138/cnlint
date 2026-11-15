/**
 * 文本与 Markdown 结构相关工具。
 */

/**
 * 把文本切成行，并去掉行尾换行符。
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

/**
 * 计算 Markdown 中「不应被检查」的行区段：
 * 围栏代码块（``` 或 ~~~）以及其内部所有行。
 * 同时对非代码块行，标出围栏标记行本身也应跳过。
 *
 * @param {string[]} lines
 * @returns {boolean[]} skip[i] === true 表示该行不参与正文规则检查
 */
export function markFencedCodeLines(lines) {
  const skip = new Array(lines.length).fill(false);
  let fence = null; // { char, len }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);

    if (fence === null) {
      // 尝试开启围栏：反引号围栏的 info string 里不能再出现反引号
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
        fence = { char: m[2][0], len: m[2].length };
        skip[i] = true;
      }
    } else {
      skip[i] = true;
      const close = line.match(/^(\s{0,3})(`{3,}|~{3,})\s*$/);
      if (
        close &&
        close[2][0] === fence.char &&
        close[2].length >= fence.len
      ) {
        fence = null;
      }
    }
  }

  return skip;
}

/**
 * 找出单行内行内代码（`code`）覆盖的列区间，供规则跳过。
 * 支持反引号数量不等的嵌套写法。
 *
 * @param {string} line
 * @returns {Array<[number, number]>} [start, endExclusive] 列表（含反引号本身）
 */
export function inlineCodeRanges(line) {
  const ranges = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }

    let openLen = 0;
    while (line[i + openLen] === '`') openLen += 1;

    // 向后找等长的闭合反引号串
    let j = i + openLen;
    let closeIdx = -1;
    while (j < line.length) {
      if (line[j] === '`') {
        let runLen = 0;
        while (line[j + runLen] === '`') runLen += 1;
        if (runLen === openLen) {
          closeIdx = j;
          break;
        }
        j += runLen;
      } else {
        j += 1;
      }
    }

    if (closeIdx === -1) {
      // 没有闭合，视为普通字符
      i += openLen;
      continue;
    }

    ranges.push([i, closeIdx + openLen]);
    i = closeIdx + openLen;
  }

  return ranges;
}

/**
 * 判断某个列位置是否落在任一区间内。
 * @param {number} pos
 * @param {Array<[number, number]>} ranges
 * @returns {boolean}
 */
export function inRanges(pos, ranges) {
  for (const [start, end] of ranges) {
    if (pos >= start && pos < end) return true;
  }
  return false;
}

/**
 * 行级 Markdown 结构类型。
 */
export const LINE_KIND = {
  blank: 'blank',
  fence: 'fence',
  heading: 'heading',
  listItem: 'listItem',
  blockquote: 'blockquote',
  tableDelimiter: 'tableDelimiter',
  tableRow: 'tableRow',
  html: 'html',
  footnote: 'footnote',
  paragraph: 'paragraph',
};

/**
 * 识别单行的 Markdown 结构。
 *
 * @param {string} line
 * @returns {{ kind: string, prefixLength: number, markers: Array<[number, number]> }}
 *   prefixLength：正文起始列（0 基），用于省略标记前缀后再应用规则
 *   markers：需要跳过的列区间（如列表符号、引用符号、表格竖线、链接语法）
 */
export function classifyLine(line) {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;

  /** @type {Array<[number, number]>} */
  const markers = [];
  let prefixLength = indent;

  if (trimmed.length === 0) {
    return { kind: LINE_KIND.blank, prefixLength: line.length, markers };
  }

  // 围栏代码标记
  if (/^(`{3,}|~{3,})/.test(trimmed)) {
    return { kind: LINE_KIND.fence, prefixLength: line.length, markers };
  }

  // 标题：## 标题
  const heading = trimmed.match(/^(#{1,6}\s+)/);
  if (heading) {
    const start = indent;
    markers.push([start, start + heading[1].length]);
    prefixLength = start + heading[1].length;
    pushLinkMarkers(line, markers);
    return { kind: LINE_KIND.heading, prefixLength, markers };
  }

  // 引用块：> 文本（支持嵌套 > 和标题）
  const quote = trimmed.match(/^((?:>\s*)+)/);
  if (quote) {
    const start = indent;
    markers.push([start, start + quote[1].length]);
    prefixLength = start + quote[1].length;
    // 引用内可能还有列表符号
    const inner = line.slice(prefixLength);
    const innerList = inner.match(/^((?:[-*+]|\d+[.)])\s+)/);
    if (innerList) {
      markers.push([prefixLength, prefixLength + innerList[1].length]);
      prefixLength += innerList[1].length;
    }
    pushLinkMarkers(line, markers);
    return { kind: LINE_KIND.blockquote, prefixLength, markers };
  }

  // 表格分隔行：| --- | :---: |
  if (/^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(trimmed) && trimmed.includes('-')) {
    return { kind: LINE_KIND.tableDelimiter, prefixLength: line.length, markers };
  }

  // 表格内容行：| a | b |
  if (trimmed.startsWith('|') || /^[^|]*\|[^|]*\|/.test(trimmed)) {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '|') markers.push([i, i + 1]);
    }
    pushLinkMarkers(line, markers);
    return { kind: LINE_KIND.tableRow, prefixLength: indent, markers };
  }

  // 列表项：- / * / + / 1. / 1)
  const list = trimmed.match(/^((?:[-*+]|\d+[.)])\s+)/);
  if (list) {
    const start = indent;
    markers.push([start, start + list[1].length]);
    prefixLength = start + list[1].length;
    // 任务列表：[ ]
    const task = line.slice(prefixLength).match(/^(\[[ xX]\]\s+)/);
    if (task) {
      markers.push([prefixLength, prefixLength + task[1].length]);
      prefixLength += task[1].length;
    }
    pushLinkMarkers(line, markers);
    return { kind: LINE_KIND.listItem, prefixLength, markers };
  }

  // 脚注定义：[^1]: 内容
  if (/^\[\^[^\]]+\]:/.test(trimmed)) {
    const start = indent;
    const m = trimmed.match(/^(\[\^[^\]]+\]:\s*)/);
    markers.push([start, start + m[1].length]);
    pushLinkMarkers(line, markers);
    return { kind: LINE_KIND.footnote, prefixLength: start + m[1].length, markers };
  }

  // HTML 标签行
  if (/^<\/?[A-Za-z][^>]*>/.test(trimmed)) {
    return { kind: LINE_KIND.html, prefixLength: line.length, markers };
  }

  pushLinkMarkers(line, markers);
  return { kind: LINE_KIND.paragraph, prefixLength, markers };
}

/**
 * 收集 Markdown 链接/图片语法本身应跳过的区间：
 * - 链接目标 ](url) 与 [文本] 的方括号
 * - 引用式链接定义 [id]: url
 * - 自动链接 <url>
 *
 * 注意：链接「文字」属于正文，应当检查，因此只跳过语法符号与 URL。
 *
 * @param {string} line
 * @param {Array<[number, number]>} markers
 */
export function pushLinkMarkers(line, markers) {
  // ]( ... ) 链接目标
  const targetRe = /\]\(([^)]*)\)/g;
  let m;
  while ((m = targetRe.exec(line)) !== null) {
    markers.push([m.index + 1, m.index + m[0].length]);
  }

  // 引用式定义 [id]: url
  const refDef = /^(\s*\[[^\]]+\]:\s*\S.*)$/;
  const rd = line.match(refDef);
  if (rd) {
    markers.push([0, line.length]);
  }

  // 自动链接 <...>
  const auto = /<[a-zA-Z][^>\s]*>/g;
  while ((m = auto.exec(line)) !== null) {
    markers.push([m.index, m.index + m[0].length]);
  }

  // 裸 URL 与邮箱
  const url = /https?:\/\/[^\s)）]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g;
  while ((m = url.exec(line)) !== null) {
    markers.push([m.index, m.index + m[0].length]);
  }

  // 加粗/斜体/删除线语法符号本身
  const emphasis = /(\*\*|__|\*|_|~~|`)/g;
  while ((m = emphasis.exec(line)) !== null) {
    markers.push([m.index, m.index + m[0].length]);
  }
}

/**
 * 判断某行是否应被整体跳过（不参与任何规则）。
 * @param {string} kind
 * @returns {boolean}
 */
export function isSkippedKind(kind) {
  return (
    kind === LINE_KIND.fence ||
    kind === LINE_KIND.tableDelimiter ||
    kind === LINE_KIND.html ||
    kind === LINE_KIND.blank
  );
}