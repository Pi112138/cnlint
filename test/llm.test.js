import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryCache, cacheKey, withCache, DEFAULT_TTL_MS } from '../src/llm/cache.js';
import { createProvider, configFromEnv, LLMError } from '../src/llm/provider.js';
import { run, mergeSemanticIssues, setupSemantic } from '../bin/cnlint.js';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------- 缓存 ----------

test('cacheKey 对相同输入稳定、不同输入不同', () => {
  assert.equal(cacheKey('句子', '按装'), cacheKey('句子', '按装'));
  assert.notEqual(cacheKey('句子', '按装'), cacheKey('另一句', '按装'));
});

test('内存缓存可读写', () => {
  const c = createMemoryCache();
  c.set('k', 'v');
  assert.equal(c.get('k'), 'v');
  assert.equal(c.size(), 1);
});

test('缓存过期后失效', async () => {
  const c = createMemoryCache({ ttlMs: 10 });
  c.set('k', 'v');
  assert.equal(c.get('k'), 'v');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(c.get('k'), undefined);
});

test('withCache 第二次相同请求命中缓存，不再调用模型', async () => {
  let calls = 0;
  const inner = {
    async chat() {
      calls += 1;
      return '[{"id":1,"isTypo":true,"correction":"安装"}]';
    },
  };
  const stats = { hits: 0, misses: 0 };
  const provider = withCache(inner, createMemoryCache(), stats);
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '请按装软件' },
  ];

  await provider.chat(messages);
  await provider.chat(messages);

  assert.equal(calls, 1);
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

// ---------- provider ----------

test('configFromEnv 缺少密钥时返回 null', () => {
  assert.equal(configFromEnv({}), null);
  assert.equal(configFromEnv({ CNLINT_API_KEY: '   ' }), null);
});

test('configFromEnv 读取并归一化配置', () => {
  const cfg = configFromEnv({
    CNLINT_API_KEY: 'sk-test',
    CNLINT_API_BASE: 'https://api.deepseek.com/v1/',
    CNLINT_MODEL: 'deepseek-chat',
  });
  assert.equal(cfg.apiKey, 'sk-test');
  assert.equal(cfg.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(cfg.model, 'deepseek-chat');
});

test('provider 携带正确请求体与鉴权头', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] }),
    };
  };
  const provider = createProvider(
    { baseUrl: 'https://x/v1', apiKey: 'sk-1', model: 'm', timeoutMs: 1000 },
    { fetchImpl },
  );
  await provider.chat([{ role: 'user', content: 'hi' }]);

  assert.equal(captured.url, 'https://x/v1/chat/completions');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-1');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'm');
  assert.equal(body.stream, false);
});

test('provider 非 2xx 抛 LLMError', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  const provider = createProvider(
    { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', timeoutMs: 1000 },
    { fetchImpl },
  );
  await assert.rejects(() => provider.chat([{ role: 'user', content: 'hi' }]), LLMError);
});

test('provider 返回结构缺少 content 抛 LLMError', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [] }) });
  const provider = createProvider(
    { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', timeoutMs: 1000 },
    { fetchImpl },
  );
  await assert.rejects(() => provider.chat([{ role: 'user', content: 'hi' }]), LLMError);
});

// ---------- 合并逻辑 ----------

test('mergeSemanticIssues：非语义问题保留，语义问题按模型结论取舍', () => {
  const quote = { ruleId: 'quotes', line: 1, column: 1, original: '"', suggestion: '“' };
  const typoA = { ruleId: 'spelling', line: 2, column: 1, original: '按装', suggestion: '安装' };
  const typoB = { ruleId: 'spelling', line: 3, column: 1, original: '必竟', suggestion: '毕竟' };

  const confirmed = [{ ...typoA, semanticConfirmed: true, suggestion: '安装' }];
  const rejected = [typoB];

  const merged = mergeSemanticIssues([quote, typoA, typoB], confirmed, rejected);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((i) => i.ruleId === 'quotes'));
  assert.equal(merged.filter((i) => i.ruleId === 'spelling').length, 1);
});

// ---------- setupSemantic 降级 ----------

test('未加 --semantic 时不启用 provider', async () => {
  const { provider } = await setupSemantic({ semantic: false }, {});
  assert.equal(provider, null);
});

test('加 --semantic 但无密钥时降级并提示', async () => {
  const out = [];
  const { provider } = await setupSemantic(
    { semantic: true },
    { stdout: (s) => out.push(s), env: {} },
  );
  assert.equal(provider, null);
  assert.ok(out.join('').includes('CNLINT_API_KEY'));
});

test('可通过 io.provider 注入假 provider（测试用）', async () => {
  const fake = { chat: async () => '[]' };
  const { provider } = await setupSemantic({ semantic: true }, { provider: fake });
  assert.equal(provider, fake);
});

// ---------- CLI 端到端（mock 模型） ----------

async function makeTempDoc(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cnlint-e2e-'));
  const file = path.join(dir, 'doc.md');
  await writeFile(file, content, 'utf8');
  return { dir, file };
}

test('端到端：模型确认错字时报告保留', async () => {
  const { dir, file } = await makeTempDoc('请按装该软件。\n');
  const out = [];
  const provider = { chat: async () => '[{"id":1,"isTypo":true,"correction":"安装"}]' };

  const code = await run([file, '--semantic'], {
    cwd: dir,
    stdout: (s) => out.push(s),
    stderr: (s) => out.push(`ERR:${s}`),
    provider,
  });

  const text = out.join('');
  assert.ok(text.includes('语义审校'));
  assert.ok(text.includes('模型确认 1 处'));
  assert.equal(code, 0);
});

test('端到端：模型排除误报后不再报告该问题', async () => {
  const { dir, file } = await makeTempDoc('请按装该软件。\n');
  const out = [];
  const provider = { chat: async () => '[{"id":1,"isTypo":false,"correction":""}]' };

  await run([file, '--semantic'], {
    cwd: dir,
    stdout: (s) => out.push(s),
    stderr: (s) => out.push(`ERR:${s}`),
    provider,
  });

  const text = out.join('');
  assert.ok(text.includes('模型排除 1 处误报'));
  assert.equal(text.includes('疑似错别字'), false);
});

test('端到端：模型抛错时降级为规则结果，不影响退出码', async () => {
  const { dir, file } = await makeTempDoc('请按装该软件。\n');
  const out = [];
  const provider = {
    chat: async () => {
      throw new LLMError('模拟网络中断');
    },
  };

  const code = await run([file, '--semantic'], {
    cwd: dir,
    stdout: (s) => out.push(s),
    stderr: (s) => out.push(`ERR:${s}`),
    provider,
  });

  const text = out.join('');
  assert.ok(text.includes('疑似错别字')); // 规则结果仍在
  assert.ok(text.includes('ERR:cnlint:')); // 有降级警告
  assert.equal(code, 0); // 不因模型失败而失败
});

test('端到端：不加 --semantic 时完全不调用模型', async () => {
  const { dir, file } = await makeTempDoc('请按装该软件。\n');
  let called = 0;
  const provider = {
    chat: async () => {
      called += 1;
      return '[]';
    },
  };

  await run([file], {
    cwd: dir,
    stdout: () => {},
    stderr: () => {},
    provider,
  });

  assert.equal(called, 0);
});

test('端到端：文件内容未被 --semantic 修改', async () => {
  const { dir, file } = await makeTempDoc('请按装该软件。\n');
  const provider = { chat: async () => '[{"id":1,"isTypo":true,"correction":"安装"}]' };

  await run([file, '--semantic'], {
    cwd: dir,
    stdout: () => {},
    stderr: () => {},
    provider,
  });

  assert.equal(await readFile(file, 'utf8'), '请按装该软件。\n');
});