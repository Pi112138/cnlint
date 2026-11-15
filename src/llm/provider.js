/**
 * 大模型提供方抽象层。
 *
 * 设计目标：
 * 1. **通用**：只实现 OpenAI 兼容的 `/chat/completions` 协议，
 *    DeepSeek / 通义千问 / 智谱 / Ollama / vLLM 等均可直接接入。
 * 2. **可注入**：通过构造参数传入 fetch 实现，测试中可完全 mock，不触网。
 * 3. **可降级**：任何异常都抛 LLMError，由调用方决定退回纯规则模式。
 */

/** 模型调用相关的错误。调用方捕获后应降级为纯规则模式。 */
export class LLMError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'LLMError';
    this.cause = cause;
  }
}

/**
 * @typedef {object} ProviderConfig
 * @property {string} baseUrl   OpenAI 兼容接口根地址，如 https://api.deepseek.com/v1
 * @property {string} apiKey    密钥
 * @property {string} model     模型名，如 deepseek-chat
 * @property {number} [timeoutMs] 单次请求超时，默认 30000
 */

/**
 * 从环境变量读取配置。
 *
 * 支持：
 *   CNLINT_API_BASE   接口根地址（默认 https://api.openai.com/v1）
 *   CNLINT_API_KEY    密钥
 *   CNLINT_MODEL      模型名
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ProviderConfig | null} 缺少 apiKey 时返回 null
 */
export function configFromEnv(env = process.env) {
  const apiKey = env.CNLINT_API_KEY ?? '';
  if (!apiKey.trim()) return null;

  return {
    baseUrl: (env.CNLINT_API_BASE ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: apiKey.trim(),
    model: env.CNLINT_MODEL ?? 'gpt-4o-mini',
    timeoutMs: Number(env.CNLINT_TIMEOUT_MS ?? 30000),
  };
}

/**
 * 创建 OpenAI 兼容的对话补全客户端。
 *
 * @param {ProviderConfig} config
 * @param {object} [deps]
 * @param {Function} [deps.fetchImpl] 用于测试注入
 * @returns {{ chat: (messages: Array, options?: object) => Promise<string> }}
 */
export function createProvider(config, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new LLMError('当前运行环境没有可用的 fetch，无法调用模型接口');
  }

  /**
   * 发送一次对话请求，返回模型回复的纯文本。
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options]
   * @param {number} [options.temperature]
   * @returns {Promise<string>}
   */
  async function chat(messages, options = {}) {
    const url = `${config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30000);

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: options.temperature ?? 0,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LLMError(
        controller.signal.aborted ? '模型请求超时' : `模型请求失败：${err.message}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 200);
      } catch {
        // 忽略读取响应体失败
      }
      throw new LLMError(`模型接口返回 ${response.status}${detail ? `：${detail}` : ''}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new LLMError('模型返回内容不是合法 JSON', err);
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new LLMError('模型返回结构中缺少 message.content');
    }

    return content;
  }

  return { chat };
}