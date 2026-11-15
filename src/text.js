/**
 * 文本工具：按行切分、定位代码块与行内代码区间。
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