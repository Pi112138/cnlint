import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from '../src/linter.js';
import { markFencedCodeLines, inlineCodeRanges } from '../src/text.js';
import { matchGlob } from '../src/linter.js';

const ALL = {
  'space-between-cn-en': 'error',
  'no-duplicate-punctuation': 'warn',
  quotes: 'error',
  'fullwidth-punct-in-latin': 'warn',
};

const ids = (text, levels = ALL) => lintText(text, { levels }).map((i) => i.ruleId);

test('中英文缺空格被检出', () => {
  assert.deepEqual(ids('使用cnlint工具'), [
    'space-between-cn-en',
    'space-between-cn-en',
  ]);
});

test('中英文有空格不误报', () => {
  assert.equal(ids('使用 cnlint 工具').length, 0);
});

test('重复标点被检出', () => {
  assert.deepEqual(ids('好，，坏？？'), [
    'no-duplicate-punctuation',
    'no-duplicate-punctuation',
  ]);
});

test('合法省略号不报重复标点', () => {
  assert.equal(ids('等等……还有...').length, 0);
});

test('中文正文半角引号被检出', () => {
  const issues = lintText('这是"示例"文本', { levels: ALL });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'quotes');
  assert.equal(issues[0].suggestion, '“示例”');
});

test('纯英文引号不误报', () => {
  assert.equal(ids('this is "quoted" text').length, 0);
});

test('围栏代码块内不检查', () => {
  const text = ['正文正常', '```js', 'const a = "使用cnlint工具，，";', '```'].join('\n');
  assert.equal(ids(text).length, 0);
});

test('行内代码不检查', () => {
  assert.equal(ids('使用 `使用cnlint工具` 说明').length, 0);
});

test('英文语境全角逗号被检出', () => {
  const issues = lintText('hello，world', { levels: ALL });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'fullwidth-punct-in-latin');
  assert.equal(issues[0].suggestion, ',');
});

test('关闭规则后不再报告', () => {
  const levels = { ...ALL, 'space-between-cn-en': false };
  assert.equal(ids('使用cnlint工具', levels).length, 0);
});

test('行号与列号准确', () => {
  const issues = lintText('第一行\n使用cnlint工具', { levels: ALL });
  assert.equal(issues[0].line, 2);
  assert.equal(issues[0].column, 2);
});

test('markFencedCodeLines 识别围栏与波浪线', () => {
  const lines = ['a', '```', 'b', '```', 'c', '~~~', 'd', '~~~'];
  assert.deepEqual(markFencedCodeLines(lines), [
    false, true, true, true, false, true, true, true,
  ]);
});

test('inlineCodeRanges 支持双反引号', () => {
  const line = 'a ``b`c`` d';
  assert.deepEqual(inlineCodeRanges(line), [[2, 9]]);
});

test('matchGlob 基本语义', () => {
  assert.equal(matchGlob('node_modules/**', 'node_modules/a/b.md'), true);
  assert.equal(matchGlob('*.md', 'README.md'), true);
  assert.equal(matchGlob('*.md', 'docs/a.md'), false);
  assert.equal(matchGlob('CHANGELOG.md', 'CHANGELOG.md'), true);
});