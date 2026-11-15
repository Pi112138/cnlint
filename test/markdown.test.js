import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from '../src/linter.js';
import { fixText } from '../src/fixer.js';
import { classifyLine, LINE_KIND, pushLinkMarkers } from '../src/text.js';

const ALL = {
  'space-between-cn-en': 'error',
  'no-duplicate-punctuation': 'warn',
  quotes: 'error',
  'fullwidth-punct-in-latin': 'warn',
  spelling: 'warn',
};

const ids = (text, levels = ALL) => lintText(text, { levels }).map((i) => i.ruleId);

test('标题标记被跳过，标题正文仍检查', () => {
  const issues = lintText('# 标题使用cnlint工具', { levels: ALL });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].column, 6); // 列号是整行坐标
});

test('标题中的正常文本不误报', () => {
  assert.deepEqual(ids('# 使用 cnlint 工具'), []);
});

test('无序列表标记被跳过', () => {
  const issues = lintText('- 使用cnlint工具', { levels: ALL });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].column, 4); // "- 使" 后为第 4 列
});

test('有序列表标记被跳过', () => {
  const issues = lintText('1. 使用cnlint工具', { levels: ALL });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].column, 5); // "1. 使" 后为第 5 列
});

test('引用块标记被跳过', () => {
  const issues = lintText('> 使用cnlint工具', { levels: ALL });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].column, 4); // "> 使" 后为第 4 列
});

test('嵌套引用与列表组合', () => {
  assert.deepEqual(ids('> - 使用 cnlint 工具'), []);
});

test('表格分隔行整行跳过', () => {
  assert.deepEqual(ids('|---|---|'), []);
  assert.deepEqual(ids('| :--- | ---: |'), []);
});

test('表格竖线被跳过，单元格内容仍检查', () => {
  const line = '| 使用cnlint工具 | 正常 |';
  const issues = lintText(line, { levels: ALL });
  assert.equal(issues.length, 2);
  // 不应在竖线处产生任何问题
  assert.equal(issues.every((i) => !i.original.includes('|')), true);
});

test('表格中的正常内容不误报', () => {
  assert.deepEqual(ids('| 使用 cnlint | 正常内容 |'), []);
});

test('链接 URL 被跳过', () => {
  assert.deepEqual(ids('[文档](https://example.com/使用cnlint工具)'), []);
});

test('链接文字仍被检查', () => {
  const issues = lintText('[使用cnlint工具](https://x.com)', { levels: ALL });
  assert.equal(issues.length, 2);
});

test('加粗符号被跳过，内容仍检查', () => {
  const issues = lintText('**使用cnlint工具**', { levels: ALL });
  assert.equal(issues.length, 2);
});

test('加粗中的正常文本不误报', () => {
  assert.deepEqual(ids('**使用 cnlint 工具**'), []);
});

test('行内代码优先于结构规则', () => {
  assert.deepEqual(ids('- 使用 `使用cnlint工具` 说明'), []);
});

test('水平分隔线整行跳过', () => {
  assert.deepEqual(ids('---'), []);
  assert.deepEqual(ids('***'), []);
});

test('围栏代码块仍整块跳过', () => {
  const text = ['```md', '# 使用cnlint工具', '```'].join('\n');
  assert.deepEqual(ids(text), []);
});

test('classifyLine 识别各类结构', () => {
  assert.equal(classifyLine('# 标题').kind, LINE_KIND.heading);
  assert.equal(classifyLine('- 项').kind, LINE_KIND.listItem);
  assert.equal(classifyLine('> 引用').kind, LINE_KIND.blockquote);
  assert.equal(classifyLine('| a | b |').kind, LINE_KIND.tableRow);
  assert.equal(classifyLine('|---|---|').kind, LINE_KIND.tableDelimiter);
  assert.equal(classifyLine('普通文本').kind, LINE_KIND.paragraph);
  assert.equal(classifyLine('').kind, LINE_KIND.blank);
  assert.equal(classifyLine('```js').kind, LINE_KIND.fence);
});

test('pushLinkMarkers 标记链接目标与裸 URL', () => {
  const markers = [];
  pushLinkMarkers('见 [a](https://x.com) 与 https://y.com', markers);
  const covered = markers.map(([s, e]) => '见 [a](https://x.com) 与 https://y.com'.slice(s, e));
  assert.ok(covered.some((c) => c.includes('https://x.com')));
  assert.ok(covered.some((c) => c === 'https://y.com'));
});

test('--fix 保留标题标记并修复内容', () => {
  const { output } = fixText('# 使用cnlint工具', { levels: ALL });
  assert.equal(output, '# 使用 cnlint 工具');
});

test('--fix 保留列表标记', () => {
  const { output } = fixText('- 使用cnlint工具', { levels: ALL });
  assert.equal(output, '- 使用 cnlint 工具');
});

test('--fix 保留引用标记', () => {
  const { output } = fixText('> 使用cnlint工具', { levels: ALL });
  assert.equal(output, '> 使用 cnlint 工具');
});

test('--fix 保留表格结构与竖线', () => {
  const { output } = fixText('| 使用cnlint工具 | 正常 |', { levels: ALL });
  assert.equal(output, '| 使用 cnlint 工具 | 正常 |');
});

test('--fix 保留加粗标记', () => {
  const { output } = fixText('**使用cnlint工具**', { levels: ALL });
  assert.equal(output, '**使用 cnlint 工具**');
});

test('--fix 不改动链接 URL', () => {
  const { output } = fixText('[使用cnlint工具](https://example.com/使用cnlint工具)', { levels: ALL });
  assert.ok(output.includes('](https://example.com/使用cnlint工具)'));
});

test('--fix 后重新检查除链接文字外无残留', () => {
  const src = ['# 使用cnlint工具', '- 使用cnlint工具', '> 使用cnlint工具', '**使用cnlint工具**'].join('\n');
  const { output } = fixText(src, { levels: ALL });
  assert.deepEqual(ids(output), []);
});

test('混合文档端到端不误报', () => {
  const doc = [
    '# 使用 cnlint 工具',
    '',
    '普通段落使用 cnlint 工具很好。',
    '',
    '- 列表项使用 cnlint 工具',
    '1. 有序列表使用 cnlint 工具',
    '',
    '> 引用使用 cnlint 工具',
    '',
    '| 列一 | 列二 |',
    '|---|---|',
    '| 使用 cnlint | 正常 |',
    '',
    '**加粗使用 cnlint 工具**',
    '',
    '[文档](https://example.com) 说明',
    '',
    '---',
  ].join('\n');
  assert.deepEqual(ids(doc), []);
});