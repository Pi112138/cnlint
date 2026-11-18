import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBinaryType } from '../src/linter.js';
import {
  findPythons,
  hasPythonDocx,
  resolvePython,
  dependencyHelp,
  runChecker,
} from '../src/docx/bridge.js';

// ---------- 二进制检测 ----------

test('检测 ZIP 容器（.docx/.xlsx/.pptx）', () => {
  const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
  const msg = detectBinaryType(buf);
  assert.ok(msg);
  assert.ok(msg.includes('cnlint docx'));
});

test('检测 PDF', () => {
  const buf = Buffer.from('%PDF-1.7\n...', 'latin1');
  assert.ok(detectBinaryType(buf).includes('PDF'));
});

test('检测旧版 Office（OLE 复合文档）', () => {
  const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]);
  assert.ok(detectBinaryType(buf).includes('旧版'));
});

test('含 NUL 字节视为二进制', () => {
  const buf = Buffer.concat([Buffer.from('abc'), Buffer.from([0]), Buffer.from('def')]);
  assert.ok(detectBinaryType(buf));
});

test('纯文本不被误判为二进制', () => {
  assert.equal(detectBinaryType(Buffer.from('# 标题\n\n正常内容。', 'utf8')), null);
  assert.equal(detectBinaryType(Buffer.from('使用 cnlint 工具', 'utf8')), null);
});

test('UTF-8 中文结尾不被误判', () => {
  // 中文的 UTF-8 字节含高位，但不应有 NUL
  assert.equal(detectBinaryType(Buffer.from('中文文档内容测试', 'utf8')), null);
});

// ---------- Python 探测 ----------

test('findPythons 返回数组且去重', () => {
  const list = findPythons(['definitely-not-a-python-exe-xyz']);
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 0);
});

test('hasPythonDocx 对不存在的解释器返回失败', () => {
  const r = hasPythonDocx('definitely-not-a-python-exe-xyz');
  assert.equal(r.ok, false);
});

test('resolvePython 找不到 Python 时给出安装提示', () => {
  const saved = process.env.CNLINT_PYTHON;
  try {
    // 临时把 PATH 清空以模拟无 Python 环境
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    delete process.env.CNLINT_PYTHON;

    const r = resolvePython();
    assert.equal(r.exe, null);
    assert.ok(r.hints.length > 0);
    const text = r.hints.join(' ');
    assert.ok(text.includes('Python') || text.includes('python-docx'));

    process.env.PATH = savedPath;
  } finally {
    if (saved === undefined) delete process.env.CNLINT_PYTHON;
    else process.env.CNLINT_PYTHON = saved;
  }
});

test('dependencyHelp 输出包含安装步骤', () => {
  const help = dependencyHelp(['Python 缺少 python-docx']);
  assert.ok(help.includes('pip install python-docx'));
  assert.ok(help.includes('python.org'));
  assert.ok(help.includes('CNLINT_PYTHON'));
});

test('runChecker 在 Python 不可用时不抛异常，返回退出码 3', () => {
  const savedPath = process.env.PATH;
  const saved = process.env.CNLINT_PYTHON;
  try {
    process.env.PATH = '';
    delete process.env.CNLINT_PYTHON;
    const r = runChecker(['no-such.docx', '--profile']);
    assert.equal(r.code, 3);
    assert.ok(r.hints && r.hints.length > 0);
  } finally {
    process.env.PATH = savedPath;
    if (saved !== undefined) process.env.CNLINT_PYTHON = saved;
  }
});