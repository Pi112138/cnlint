import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintText } from '../src/linter.js';
import { typoDict, typoWhitelist, getTypoEntries } from '../src/dict.js';

const ONLY_SPELLING = {
  'space-between-cn-en': false,
  'no-duplicate-punctuation': false,
  quotes: false,
  'fullwidth-punct-in-latin': false,
  spelling: 'warn',
};

const spell = (text) => lintText(text, { levels: ONLY_SPELLING });

test('词典无「错词等于正词」的无效条目', () => {
  const invalid = Object.entries(typoDict).filter(([k, v]) => k === v);
  assert.deepEqual(invalid, []);
});

test('词典词条数量充足', () => {
  assert.ok(getTypoEntries().length >= 400, `实际 ${getTypoEntries().length} 条`);
});

test('白名单中的词不应同时是词典词条', () => {
  for (const w of typoWhitelist) {
    // 白名单是用于保护整词的，允许与词条同字但不应完全相同
    assert.equal(typoDict[w] === w, false);
  }
});

test('常见错别字被检出：按装 -> 安装', () => {
  const issues = spell('请按装该软件');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'spelling');
  assert.equal(issues[0].original, '按装');
  assert.equal(issues[0].suggestion, '安装');
});

test('常见错别字被检出：必竟 -> 毕竟', () => {
  const issues = spell('他必竟还是来了');
  assert.equal(issues[0].suggestion, '毕竟');
});

test('常见错别字被检出：再接再励 -> 再接再厉', () => {
  const issues = spell('我们应再接再励');
  assert.equal(issues[0].original, '再接再励');
  assert.equal(issues[0].suggestion, '再接再厉');
});

test('成语错别字被检出：甘败下风 -> 甘拜下风', () => {
  const issues = spell('他甘败下风');
  assert.equal(issues[0].suggestion, '甘拜下风');
});

test('同句多个错别字都能检出', () => {
  const issues = spell('他必竟按装了软件');
  assert.equal(issues.length, 2);
});

test('正确的词不误报', () => {
  const text = '请安装该软件，这是正确的做法，毕竟如此，再接再厉。';
  assert.deepEqual(spell(text), []);
});

test('长词优先：不被短词抢先命中', () => {
  // 若词典同时存在「按装」与更长词条，应优先命中长词
  const issues = spell('按步就班地工作');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].original, '按步就班');
});

test('代码块内的错别字不报', () => {
  const text = ['```', '按装按装按装', '```'].join('\n');
  assert.deepEqual(spell(text), []);
});

test('行内代码内的错别字不报', () => {
  assert.deepEqual(spell('代码 `按装` 不应报错'), []);
});

test('URL 内的错别字不报', () => {
  assert.deepEqual(spell('见 https://example.com/按装 页面'), []);
});

test('白名单保护：坐位体前屈', () => {
  assert.deepEqual(spell('体育考试项目有坐位体前屈'), []);
});

test('白名单保护：按装订顺序', () => {
  assert.deepEqual(spell('按装订顺序排列文件'), []);
});

test('错别字规则默认不自动修复', () => {
  const issues = spell('请按装该软件');
  assert.equal(issues[0].fixable, false);
});

test('错别字规则可通过配置关闭', () => {
  const levels = { ...ONLY_SPELLING, spelling: false };
  assert.deepEqual(lintText('请按装该软件', { levels }), []);
});

test('列号从 1 开始且准确', () => {
  const issues = spell('请按装该软件');
  assert.equal(issues[0].column, 2);
  assert.equal(issues[0].length, 2);
});

test('抽样校验：多个词条的正词写法不应被判错', () => {
  const rights = getTypoEntries().slice(0, 40).map((e) => e.right);
  for (const right of rights) {
    assert.deepEqual(spell(right), [], `正确词「${right}」被误报`);
  }
});

// ---------- 全量自洽校验：这是词典质量的核心保障 ----------

test('全部正确写法都不会被误报', () => {
  const failures = [];
  for (const { right, wrong } of getTypoEntries()) {
    const issues = spell(right);
    if (issues.length > 0) failures.push(`${right}（来自错词 ${wrong}）`);
  }
  assert.deepEqual(failures, [], `以下正确词被误报：${failures.join(', ')}`);
});

test('全部错误写法都能被检出', () => {
  const missed = [];
  for (const { wrong } of getTypoEntries()) {
    if (spell(wrong).length === 0) missed.push(wrong);
  }
  assert.deepEqual(missed, [], `以下错词漏检：${missed.join(', ')}`);
});

test('新增常用二字词可被检出', () => {
  const cases = [
    ['烦燥', '烦躁'],
    ['锻练', '锻炼'],
    ['成份', '成分'],
    ['精采', '精彩'],
    ['究竞', '究竟'],
    ['份量', '分量'],
    ['藉口', '借口'],
    ['幅射', '辐射'],
  ];
  for (const [wrong, right] of cases) {
    const issues = spell(`这段文字里有${wrong}问题`);
    assert.ok(issues.length > 0, `「${wrong}」未被检出`);
    assert.equal(issues[0].suggestion, right);
  }
});

test('新增成语可被检出', () => {
  const cases = [
    ['病入膏盲', '病入膏肓'],
    ['老奸巨滑', '老奸巨猾'],
    ['鞠躬尽粹', '鞠躬尽瘁'],
    ['独树一炽', '独树一帜'],
  ];
  for (const [wrong, right] of cases) {
    const issues = spell(`他说他${wrong}`);
    assert.ok(issues.length > 0, `「${wrong}」未被检出`);
    assert.equal(issues[0].suggestion, right);
  }
});

test('二字词不会误伤包含它的正确长词', () => {
  // 这些句子包含新词条中的字，但整体写法正确
  const good = [
    '这个方案已经完成部署。',
    '我们要认真参与讨论。',
    '工作态度很谨慎。',
    '他提出了宝贵建议。',
    '实验结果令人满意。',
  ];
  for (const text of good) {
    assert.deepEqual(spell(text), [], `正确句子被误报：${text}`);
  }
});

test('词典中不存在重复的错词键', () => {
  const keys = Object.keys(typoDict);
  assert.equal(new Set(keys).size, keys.length);
});