import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../bin/cnlint.js';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function makeDoc(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cnlint-report-'));
  const file = path.join(dir, 'doc.md');
  await writeFile(file, content, 'utf8');
  return { dir, file };
}

async function runCli(args, cwd) {
  const out = [];
  const code = await run(args, {
    cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => out.push(`ERR:${s}`),
  });
  return { text: out.join(''), code };
}

const MIXED = '# 示例\n\n使用cnlint工具，，这是"示例"。\n\n请按装该软件。\n';

test('默认只报告不修改文件', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file], dir);

  assert.ok(text.includes('可用 --fix 自动修复'));
  assert.ok(text.includes('其中 4 处可用 --fix 自动修复'));
  assert.equal(await readFile(file, 'utf8'), MIXED);
});

test('仅检查模式统计可修复数量', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file], dir);
  assert.match(text, /其中 4 处可用 --fix 自动修复/);
});

test('--fix 报告分为「已修复」和「仍需人工处理」两块', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file, '--fix'], dir);

  assert.ok(text.includes('🔧 已修复 4 处问题'));
  assert.ok(text.includes('⚠️ 仍需人工处理 1 处（无法自动修复）'));
  assert.ok(text.includes('📋 汇总：已修复 4 处，仍需人工处理 1 处'));
});

test('--fix 两块顺序：已修复在前，需人工在后', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file, '--fix'], dir);
  const fixedIdx = text.indexOf('已修复 4 处');
  const remainIdx = text.indexOf('仍需人工处理 1 处');
  assert.ok(fixedIdx !== -1 && remainIdx !== -1);
  assert.ok(fixedIdx < remainIdx);
});

test('--fix 实际写入文件，未修问题保留原样', async () => {
  const { dir, file } = await makeDoc(MIXED);
  await runCli([file, '--fix'], dir);
  const after = await readFile(file, 'utf8');

  assert.ok(after.includes('使用 cnlint 工具'));
  assert.ok(after.includes('这是“示例”'));
  assert.ok(after.includes('请按装该软件')); // 错别字未被改
});

test('--dry-run 列出将要修复的内容但不写文件', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file, '--fix', '--dry-run'], dir);

  assert.ok(text.includes('可修复 4 处问题'));
  assert.ok(text.includes('--dry-run，未写入文件'));
  assert.ok(text.includes('用c → 用 c'));
  assert.equal(await readFile(file, 'utf8'), MIXED);
});

test('--dry-run 也分两块展示', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file, '--fix', '--dry-run'], dir);
  assert.ok(text.includes('可修复 4 处'));
  assert.ok(text.includes('仍需人工处理 1 处'));
});

test('--fix 全部可修时提示无残留', async () => {
  const { dir, file } = await makeDoc('使用cnlint工具。\n');
  const { text } = await runCli([file, '--fix'], dir);
  assert.ok(text.includes('✨ 全部处理完毕：已修复 2 处，无残留'));
});

test('--fix 无任何问题时提示没有发现问题', async () => {
  const { dir, file } = await makeDoc('内容正常，没有问题。\n');
  const { text } = await runCli([file, '--fix'], dir);
  assert.ok(text.includes('没有可自动修复的问题'));
  assert.ok(text.includes('✨ 没有发现任何问题'));
});

test('--fix 修复后退出码为 0（无 error 残留）', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { code } = await runCli([file, '--fix'], dir);
  assert.equal(code, 0);
});

test('仍有 error 级未修问题时退出码为 1', async () => {
  // 构造一个不可修复且为 error 级的问题：关闭 fixable 规则，只留 quotes(error) 但让它不可修
  const { dir, file } = await makeDoc('这是"示例"文本。\n');
  // 默认 quotes 可自动修复，这里用配置文件把它关掉，再打开 spelling 制造 error
  await writeFile(
    path.join(dir, '.cnlintrc.json'),
    JSON.stringify({ rules: { quotes: 'off', spelling: 'error' } }),
    'utf8',
  );
  await writeFile(file, '请按装该软件。\n', 'utf8');

  const { code, text } = await runCli([file, '--fix'], dir);
  assert.ok(text.includes('仍需人工处理'));
  assert.equal(code, 1);
});

test('--fix 不带 --dry-run 时不再逐条打印旧格式', async () => {
  const { dir, file } = await makeDoc(MIXED);
  const { text } = await runCli([file, '--fix'], dir);
  // 旧格式里出现过的措辞不应再出现
  assert.equal(text.includes('共发现'), false);
  assert.equal(text.includes('已自动修复'), false);
});