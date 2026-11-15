import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessages,
  parseVerdicts,
  reviewIssues,
  isSemanticCandidate,
  sentenceAt,
  SEMANTIC_RULE_IDS,
} from '../src/llm/semantic.js';
import { LLMError } from '../src/llm/provider.js';

/** 构造一处规则问题 */
const issue = (over = {}) => ({
  ruleId: 'spelling',
  line: 1,
  column: 3,
  original: '按装',
  suggestion: '安装',
  message: '疑似错别字：按装 → 安装',
  severity: 'warn',
  fixable: false,
  ...over,
});

/** 假 provider：按预设返回 */
function fakeProvider(reply) {
  const calls = [];
  return {
    calls,
    async chat(messages) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(messages) : reply;
    },
  };
}

test('只有 spelling 是语义审校候选', () => {
  assert.equal(isSemanticCandidate({ ruleId: 'spelling' }), true);
  assert.equal(isSemanticCandidate({ ruleId: 'quotes' }), false);
  assert.equal(isSemanticCandidate({ ruleId: 'space-between-cn-en' }), false);
  assert.deepEqual([...SEMANTIC_RULE_IDS], ['spelling']);
});

test('sentenceAt 取出对应行（1-based）', () => {
  const text = '第一行\n请按装软件\n第三行';
  assert.equal(sentenceAt(text, 2), '请按装软件');
});

test('buildMessages 包含系统提示与结构化载荷', () => {
  const msgs = buildMessages([{ id: 1, sentence: '请按装软件', word: '按装', suggestion: '安装' }]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('JSON'));
  const payload = JSON.parse(msgs[1].content.slice(msgs[1].content.indexOf('[')));
  assert.equal(payload[0].suspectedWrongWord, '按装');
});

test('parseVerdicts 解析纯 JSON 数组', () => {
  const out = parseVerdicts('[{"id":1,"isTypo":true,"correction":"安装"}]');
  assert.equal(out.length, 1);
  assert.equal(out[0].isTypo, true);
  assert.equal(out[0].correction, '安装');
});

test('parseVerdicts 容忍 markdown 代码块包裹', () => {
  const out = parseVerdicts('```json\n[{"id":1,"isTypo":false,"correction":""}]\n```');
  assert.equal(out[0].isTypo, false);
});

test('parseVerdicts 容忍前后夹带说明文字', () => {
  const out = parseVerdicts('好的，结果如下：\n[{"id":2,"isTypo":true,"correction":"毕竟"}]\n以上。');
  assert.equal(out[0].id, 2);
});

test('parseVerdicts 对非法内容抛出 LLMError', () => {
  assert.throws(() => parseVerdicts('这不是 JSON'), LLMError);
  assert.throws(() => parseVerdicts(''), LLMError);
  assert.throws(() => parseVerdicts('{"id":1}'), LLMError); // 不是数组
});

test('模型确认是错字 → 保留并采用模型的正确写法', async () => {
  const provider = fakeProvider('[{"id":1,"isTypo":true,"correction":"安装"}]');
  const { confirmed, rejected } = await reviewIssues([issue()], '请按装该软件', provider);
  assert.equal(confirmed.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(confirmed[0].suggestion, '安装');
  assert.equal(confirmed[0].semanticConfirmed, true);
});

test('模型确认是错字 → 模型给出不同写法时以模型为准', async () => {
  const provider = fakeProvider('[{"id":1,"isTypo":true,"correction":"见装"}]');
  const { confirmed } = await reviewIssues([issue()], '请按装该软件', provider);
  assert.equal(confirmed[0].suggestion, '见装');
});

test('模型否定 → 归入 rejected（减少误报）', async () => {
  const provider = fakeProvider('[{"id":1,"isTypo":false,"correction":""}]');
  const { confirmed, rejected } = await reviewIssues([issue()], '某产品叫按装', provider);
  assert.equal(confirmed.length, 0);
  assert.equal(rejected.length, 1);
});

test('模型漏答某条 → 保守保留规则结果', async () => {
  const provider = fakeProvider('[]');
  const { confirmed } = await reviewIssues([issue()], '请按装该软件', provider);
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].semanticConfirmed, undefined);
});

test('模型调用失败 → 降级保留规则结果并回调警告', async () => {
  const warnings = [];
  const provider = fakeProvider(new LLMError('网络错误'));
  const { confirmed } = await reviewIssues([issue()], '请按装该软件', provider, {
    onWarn: (m) => warnings.push(m),
  });
  assert.equal(confirmed.length, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('语义审校失败'));
});

test('非语义类问题不发给模型', async () => {
  const provider = fakeProvider('[]');
  const issues = [issue({ ruleId: 'quotes' }), issue()];
  const { skipped } = await reviewIssues(issues, '请按装该软件', provider);
  // 只把 1 条 spelling 发出去
  assert.equal(provider.calls.length, 1);
  const payload = provider.calls[0][1].content;
  assert.equal(payload.includes('quotes'), false);
});

test('没有候选问题时不调用模型', async () => {
  const provider = fakeProvider('[]');
  const { confirmed, rejected } = await reviewIssues([issue({ ruleId: 'quotes' })], 'x', provider);
  assert.equal(provider.calls.length, 0);
  assert.equal(confirmed.length, 0);
  assert.equal(rejected.length, 0);
});

test('多条问题一次批量审校，id 一一对应', async () => {
  const provider = fakeProvider((messages) => {
    const payload = JSON.parse(messages[1].content.slice(messages[1].content.indexOf('[')));
    return JSON.stringify(
      payload.map((p) => ({ id: p.id, isTypo: p.id === 2, correction: p.id === 2 ? '安装' : '' })),
    );
  });
  const issues = [issue({ column: 3 }), issue({ column: 10 })];
  const { confirmed, rejected } = await reviewIssues(issues, '请按装该软件，再按装一次', provider);
  assert.equal(confirmed.length, 1);
  assert.equal(rejected.length, 1);
});