import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixText, fixLine } from '../src/fixer.js';
import { lintText } from '../src/linter.js';
import { inLinkOrUrl } from '../src/rules.js';

const ALL = {
  'space-between-cn-en': 'error',
  'no-duplicate-punctuation': 'warn',
  quotes: 'error',
  'fullwidth-punct-in-latin': 'warn',
};

test('修复中英文缺空格（同一行多处偏移正确）', () => {
  const { output } = fixText('使用cnlint工具', { levels: ALL });
  assert.equal(output, '使用 cnlint 工具');
});

test('修复重复标点', () => {
  const { output } = fixText('很好，，但是？？', { levels: ALL });
  assert.equal(output, '很好，但是？');
});

test('修复中文正文半角双引号', () => {
  const { output } = fixText('这是"示例"文本', { levels: ALL });
  assert.equal(output, '这是“示例”文本');
});

test('代码块内容不被修改', () => {
  const text = ['```js', 'const a = "使用cnlint工具，，";', '```'].join('\n');
  const { output, fixed } = fixText(text, { levels: ALL });
  assert.equal(output, text);
  assert.equal(fixed.length, 0);
});

test('行内代码不被修改', () => {
  const text = '使用 `使用cnlint工具` 说明';
  const { output } = fixText(text, { levels: ALL });
  assert.equal(output, text);
});

test('不可修复的问题保留在 remaining 中', () => {
  const { output, fixed, remaining } = fixText('hello，world', { levels: ALL });
  assert.equal(output, 'hello，world');
  assert.equal(fixed.length, 0);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].ruleId, 'fullwidth-punct-in-latin');
});

test('可修复与不可修复混合', () => {
  const { output, fixed, remaining } = fixText('使用cnlint工具，hello，world', { levels: ALL });
  assert.equal(output, '使用 cnlint 工具，hello，world');
  assert.equal(fixed.length, 2);
  assert.equal(remaining.length, 1);
});

test('保留 CRLF 换行风格', () => {
  const text = '使用cnlint工具\r\n第二行';
  const { output } = fixText(text, { levels: ALL });
  assert.ok(output.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(output));
});

test('保留文件末尾换行', () => {
  assert.equal(fixText('使用cnlint工具\n', { levels: ALL }).output.endsWith('\n'), true);
  assert.equal(fixText('使用cnlint工具', { levels: ALL }).output.endsWith('\n'), false);
});

test('修复后重新检查不再报同样问题', () => {
  const { output } = fixText('使用cnlint工具\n这是"示例"文本\n很好，，', { levels: ALL });
  const after = lintText(output, { levels: ALL });
  assert.equal(after.length, 0);
});

test('URL 内部的文本不被误判', () => {
  const line = '参见 https://example.com/使用cnlint工具 页面';
  // URL 内部的换行/空格问题不应被报告为可修复
  assert.equal(inLinkOrUrl(line, line.indexOf('使用cnlint工具')), true);
});

test('markdown 链接目标不被误判', () => {
  const line = '文档见 [cnlint](https://github.com/Pi112138/cnlint) 说明';
  assert.equal(inLinkOrUrl(line, line.indexOf('Pi112138')), true);
});

test('fixLine 忽略重叠区间不破坏文本', () => {
  const line = 'abc';
  const issues = [
    { column: 1, length: 3, suggestion: 'X', fixable: true },
    { column: 2, length: 2, suggestion: 'YY', fixable: true },
  ];
  const out = fixLine(line, issues);
  assert.equal(typeof out, 'string');
  assert.equal(out.length > 0, true);
});