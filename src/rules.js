/**
 * 规则集合。
 *
 * 每条规则形如：
 *   {
 *     id: 'space-between-cn-en',
 *     description: '...',
 *     check(line, ctx) -> Issue[]
 *   }
 * Issue: { ruleId, column, length, message, original, suggestion }
 */

const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf';
const CJK_OR_FULLWIDTH_PUNCT = `${CJK}\\u3000-\\u303f\\uff00-\\uffef`;

/** 中文（含 harmony / 扩展 A 常用区）字符 */
const RE_CJK = new RegExp(`[${CJK}]`);
/** 英文/数字字符 */
const RE_LATIN = /[A-Za-z0-9]/;

/**
 * 规则：中英文之间缺少空格。
 * 只在「中文 | 英文数字」直接相邻且两侧都不是标点时报告。
 */
const spaceBetweenCnEn = {
  id: 'space-between-cn-en',
  description: '中文与英文/数字之间应有一个空格',
  check(line, ctx) {
    const issues = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      if (ctx.isSkipped(i) || ctx.isSkipped(i + 1)) continue;

      const cnBefore = RE_CJK.test(a);
      const latinAfter = RE_LATIN.test(b);
      const latinBefore = RE_LATIN.test(a);
      const cnAfter = RE_CJK.test(b);

      if ((cnBefore && latinAfter) || (latinBefore && cnAfter)) {
        // 排除 markdown 语义字符、URL、文件扩展名等噪声由调用方预处理
        issues.push({
          ruleId: this.id,
          column: i + 1,
          length: 2,
          message: '中英文之间缺少空格',
          original: a + b,
          suggestion: `${a} ${b}`,
        });
      }
    }
    return issues;
  },
};

/**
 * 规则：重复标点。
 * 捕获「，。？！、；：」等中文标点的连续重复（不含省略号与破折号等合法用法）。
 */
const noDuplicatePunctuation = {
  id: 'no-duplicate-punctuation',
  description: '避免连续重复的中文标点',
  check(line, ctx) {
    const issues = [];
    const target = /[，。？！、；：,]/;

    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      if (ctx.isSkipped(i) || ctx.isSkipped(i + 1)) continue;
      if (!target.test(a) || !target.test(b)) continue;

      // 允许合法的英文省略号 "..." 与中文 "……"
      if (a === '.' && b === '.') continue;

      issues.push({
        ruleId: this.id,
        column: i + 1,
        length: 2,
        message: '检测到重复标点',
        original: a + b,
        suggestion: a,
      });
    }
    return issues;
  },
};

/**
 * 规则：正文误用半角引号。
 * 检测成对的 "..." 或英文单引号用于中文正文，建议改为中文引号。
 */
const quotes = {
  id: 'quotes',
  description: '中文正文应使用中文引号 “ ” 而非半角引号',
  check(line, ctx) {
    const issues = [];
    for (let i = 0; i < line.length; i++) {
      if (ctx.isSkipped(i)) continue;
      if (line[i] !== '"') continue;

      // 找配对的下一个半角双引号
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (ctx.isSkipped(j)) break;
        j += 1;
      }
      if (j >= line.length || line[j] !== '"') continue;

      const inner = line.slice(i + 1, j);
      // 只有内含中文时才认为这是「中文正文里的英文引号」
      if (!RE_CJK.test(inner)) {
        i = j;
        continue;
      }

      issues.push({
        ruleId: this.id,
        column: i + 1,
        length: j - i + 1,
        message: '正文误用半角双引号',
        original: line.slice(i, j + 1),
        suggestion: `“${inner}”`,
      });
      i = j;
    }
    return issues;
  },
};

/**
 * 规则：全角标点误用（英文语境下使用全角标点）。
 * 例如 "hello，world" 中逗号应为半角。
 */
const punctWidth = {
  id: 'fullwidth-punct-in-latin',
  description: '英文语境中应使用半角标点',
  check(line, ctx) {
    const issues = [];
    for (let i = 0; i < line.length; i++) {
      if (ctx.isSkipped(i)) continue;
      const ch = line[i];
      const half = { '，': ',', '；': ';', '：': ':', '。': '.', '？': '?', '！': '!' }[ch];
      if (!half) continue;

      const before = line[i - 1] ?? '';
      const after = line[i + 1] ?? '';

      // 仅当逗号/分号/冒号两侧都是英文或数字时提示
      if ('，；：'.includes(ch) && !/[A-Za-z0-9)]/.test(before)) continue;
      if ('，；：'.includes(ch) && !/[A-Za-z0-9(]/.test(after)) continue;
      if (!/[A-Za-z0-9)\]"'“”]/.test(before) || !/[A-Za-z0-9(\["“”]/.test(after)) continue;

      issues.push({
        ruleId: this.id,
        column: i + 1,
        length: 1,
        message: '英文语境中误用全角标点',
        original: ch,
        suggestion: half,
      });
    }
    return issues;
  },
};

export const rules = [
  spaceBetweenCnEn,
  noDuplicatePunctuation,
  quotes,
  punctWidth,
];

export const ruleIds = rules.map((r) => r.id);

/** 默认规则级别 */
export const defaultRuleLevels = {
  'space-between-cn-en': 'error',
  'no-duplicate-punctuation': 'warn',
  quotes: 'error',
  'fullwidth-punct-in-latin': 'warn',
};

export { RE_CJK, RE_LATIN, CJK_OR_FULLWIDTH_PUNCT };