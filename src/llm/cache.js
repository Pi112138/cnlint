/**
 * 语义审校结果缓存。
 *
 * 同一句子中的同一疑似错词，在 TTL 内不重复请求模型，
 * 避免「改一个词跑一次检查」导致费用翻倍。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** 默认缓存有效期：7 天 */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 生成缓存键。
 * @param {string} sentence
 * @param {string} word
 * @returns {string}
 */
export function cacheKey(sentence, word) {
  return createHash('sha1').update(`${sentence}\u0000${word}`).digest('hex');
}

/**
 * 内存缓存（进程内）。测试与短生命周期场景够用。
 *
 * @param {object} [options]
 * @param {number} [options.ttlMs]
 * @returns {{ get: Function, set: Function, size: Function }}
 */
export function createMemoryCache(options = {}) {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  /** @type {Map<string, {value: object, at: number}>} */
  const store = new Map();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() - entry.at > ttl) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      store.set(key, { value, at: Date.now() });
    },
    size() {
      return store.size;
    },
  };
}

/**
 * 磁盘缓存，落在系统临时目录，重启后仍有效。
 *
 * @param {object} [options]
 * @param {string} [options.dir] 缓存目录
 * @param {number} [options.ttlMs]
 * @returns {Promise<{ get: Function, set: Function, flush: Function, dir: string }>}
 */
export async function createFileCache(options = {}) {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const dir = options.dir ?? path.join(os.tmpdir(), 'cnlint-semantic-cache');
  const file = path.join(dir, 'cache.json');

  let data = {};
  try {
    data = JSON.parse(await readFile(file, 'utf8')) ?? {};
  } catch {
    data = {};
  }

  let dirty = false;

  return {
    dir,
    get(key) {
      const entry = data[key];
      if (!entry) return undefined;
      if (Date.now() - entry.at > ttl) {
        delete data[key];
        dirty = true;
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      data[key] = { value, at: Date.now() };
      dirty = true;
    },
    async flush() {
      if (!dirty) return;
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(file, JSON.stringify(data), 'utf8');
        dirty = false;
      } catch {
        // 缓存写入失败不影响主流程
      }
    },
  };
}

/**
 * 把缓存包装进 provider，命中缓存则不调用模型。
 *
 * @param {{chat: Function}} provider
 * @param {object} cache
 * @param {object} [stats] 统计信息对象，会被就地更新 { hits, misses }
 * @returns {{chat: Function}}
 */
export function withCache(provider, cache, stats = { hits: 0, misses: 0 }) {
  return {
    stats,
    async chat(messages, options) {
      // 仅针对「单条问题」的请求做缓存：user 内容里包含句子与词
      const userMessage = messages.find((m) => m.role === 'user');
      if (!userMessage) {
        stats.misses += 1;
        return provider.chat(messages, options);
      }

      const key = createHash('sha1')
        .update(`${messages[0]?.content ?? ''}\u0001${userMessage.content}`)
        .digest('hex');

      const cached = cache.get(key);
      if (cached !== undefined) {
        stats.hits += 1;
        return cached;
      }

      stats.misses += 1;
      const reply = await provider.chat(messages, options);
      cache.set(key, reply);
      return reply;
    },
  };
}