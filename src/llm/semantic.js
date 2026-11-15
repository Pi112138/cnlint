/**
 * 语义审校器：用大模型二次确认规则引擎报出的「疑似问题」。
 *
 * 工作方式（方案 B）：
 *   规则引擎负责「找嫌疑人」——给出疑似错字及其所在句子；
 *   模型负责「定罪」——判断该处是否真的是错别字，并给出正确写法。
 *
 * 只处理规则已命中的少量位置，因此调用量小、成本可控。
 */

import { LLMError } from './provider.js';

/** 交给模型审校的规则白名单：只有这些规则的问题值得语义判断 */
export const SEMANTIC_RULE_IDS = new Set(['spelling']);

/** 单次请求最多审校多少处问题 */
export const MAX_ITEMS_PER_REQUEST = 20;

const SYSTEM_PROMPT = `你是一名严谨的中文文字校对专家。

用户会给你一组「待确认的疑似错别字」，每项包含序号、所在句子、以及规则引擎认为的错词。
你的任务是逐条判断：在给定句子中，该词是否确实是错别字。

判断规则：
1. 只依据句子的字面意思判断，不要联想上下文之外的内容。
2. 如果该词是专有名词、人名、品牌名、书名、引用的原文、代码标识符，则判定为「不是错字」。
3. 如果该词在句子里用法正确，判定为「不是错字」。
4. 只有在句子中确实用错了字，才判定为「是错字」。
5. 不确定时，判定为「不是错字」（宁可漏报，避免误改）。

严格按 JSON 数组输出，不要输出任何解释、markdown 代码块或额外文字：
[{"id": 1, "isTypo": true, "correction": "正确的词", "reason": "简短理由"}]

其中 id 必须与输入的序号一致；isTypo 为 false 时 correction 填空字符串。`;

/**
 * 把待审校问题组装成提示词。
 *
 * @param {Array<{id: number, sentence: string, word: string, suggestion: string}>} items
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages(items) {
  const payload = items.map((it) => ({
    id: it.id,
    sentence: it.sentence,
    suspectedWrongWord: it.word,
    ruleSuggestion: it.suggestion,
  }));

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请判断下列疑似错别字：\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

/**
 * 解析模型返回的 JSON。
 *
 * 容错策略：
 * - 允许模型多包了 ```json 代码块
 * - 允许前后有说明文字（尝试截取第一个 [ 到最后一个 ]）
 *
 * @param {string} raw
 * @returns {Array<{id: number, isTypo: boolean, correction: string, reason?: string}>}
 */
export function parseVerdicts(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new LLMError('模型返回内容为空');
  }

  let text = raw.trim();

  // 去掉 markdown 代码块围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // 截取最外层数组
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new LLMError('模型返回内容无法解析为 JSON', err);
  }

  if (!Array.isArray(parsed)) {
    throw new LLMError('模型返回的 JSON 不是数组');
  }

  return parsed
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      id: Number(v.id),
      isTypo: v.isTypo === true,
      correction: typeof v.correction === 'string' ? v.correction.trim() : '',
      reason: typeof v.reason === 'string' ? v.reason : '',
    }))
    .filter((v) => Number.isInteger(v.id));
}

/**
 * 判断某条规则问题是否适合交给模型审校。
 * @param {object} issue
 * @returns {boolean}
 */
export function isSemanticCandidate(issue) {
  return SEMANTIC_RULE_IDS.has(issue.ruleId);
}

/**
 * 从整篇文本中取出某一行（1-based）的句子作为上下文。
 *
 * @param {string} text
 * @param {number} lineNumber 1-based
 * @returns {string}
 */
export function sentenceAt(text, lineNumber) {
  const lines = text.split(/\r\n|\r|\n/);
  const line = lines[lineNumber - 1] ?? '';
  return line.trim();
}

/**
 * 审校一批问题。
 *
 * @param {Array<object>} issues 规则引擎报出的问题（需含 ruleId/line/column/original/suggestion）
 * @param {string} text 原文
 * @param {object} provider { chat }
 * @param {object} [options]
 * @param {Function} [options.onWarn] 降级/异常时的提示回调
 * @returns {Promise<{ confirmed: Array, rejected: Array, skipped: number }>}
 */
export async function reviewIssues(issues, text, provider, options = {}) {
  const onWarn = options.onWarn ?? (() => {});
  const candidates = issues.filter(isSemanticCandidate);

  const confirmed = [];
  const rejected = [];

  if (candidates.length === 0) {
    return { confirmed, rejected, skipped: 0 };
  }

  // 分批，避免单次请求过大
  for (let offset = 0; offset < candidates.length; offset += MAX_ITEMS_PER_REQUEST) {
    const batch = candidates.slice(offset, offset + MAX_ITEMS_PER_REQUEST);

    const items = batch.map((issue, i) => ({
      id: i + 1,
      sentence: sentenceAt(text, issue.line),
      word: issue.original,
      suggestion: issue.suggestion,
    }));

    let verdicts;
    try {
      const reply = await provider.chat(buildMessages(items), { temperature: 0 });
      verdicts = parseVerdicts(reply);
    } catch (err) {
      // 任何失败都降级：该批次全部保留规则原始判断
      onWarn(`语义审校失败，本批 ${batch.length} 处按规则结果保留：${err.message}`);
      confirmed.push(...batch);
      continue;
    }

    const byId = new Map(verdicts.map((v) => [v.id, v]));

    batch.forEach((issue, i) => {
      const verdict = byId.get(i + 1);

      // 模型没有回答这一条 → 保守保留
      if (!verdict) {
        confirmed.push(issue);
        return;
      }

      if (!verdict.isTypo) {
        rejected.push(issue);
        return;
      }

      // 模型确认是错字：优先采用模型给出的正确写法
      confirmed.push({
        ...issue,
        suggestion: verdict.correction || issue.suggestion,
        semanticConfirmed: true,
        semanticReason: verdict.reason || '',
      });
    });
  }

  return { confirmed, rejected, skipped: issues.length - candidates.length };
}