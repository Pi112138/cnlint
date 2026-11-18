#!/usr/bin/env node
/**
 * cnlint CLI。
 *
 * 用法：
 *   cnlint <文件或目录...>
 *   cnlint ./docs/ --ext .md,.txt
 *   cnlint --staged
 */

import path from 'node:path';
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { lintFile, detectBinaryType } from '../src/linter.js';
import { fixText } from '../src/fixer.js';
import { createProvider, configFromEnv } from '../src/llm/provider.js';
import { reviewIssues, isSemanticCandidate } from '../src/llm/semantic.js';
import { createMemoryCache, withCache } from '../src/llm/cache.js';
import { runChecker, runFixer, dependencyHelp, resolvePython } from '../src/docx/bridge.js';
import {
  collectFiles,
  loadConfig,
  stagedFiles,
  isDirectory,
  DEFAULT_EXTENSIONS,
} from '../src/files.js';

const HELP = `cnlint — 中文文档排版 & 拼写检查

用法
  cnlint <文件或目录...> [选项]             检查 Markdown / 文本
  cnlint docx <文档.docx> [选项]            检查 Word 文档格式

Markdown 选项
  -e, --ext <列表>     扫描的扩展名，逗号分隔（默认 .md,.txt）
      --staged         只检查 git 暂存区里的文件
  -f, --fix            自动修复可安全修复的问题并写回文件
  -n, --dry-run        配合 --fix 使用：只显示将要修复的内容，不写文件
  -s, --semantic       调用大模型二次确认疑似错别字（需配置 API）
  -q, --quiet          只输出汇总，不逐条列出问题
  -c, --config <路径>  指定配置文件（默认向上查找 .cnlintrc.json）
  -v, --version        显示版本
  -h, --help           显示帮助

Word 选项（需先安装 python-docx）
  cnlint docx <待检测.docx> --spec <格式要求.docx>  用另一份文档当标准
  cnlint docx <待检测.docx> --rules <rules.json>    用 JSON 规则
  cnlint docx <文档.docx> --profile                 查看文档现有格式

环境变量
  CNLINT_API_KEY       模型接口密钥（--semantic 所需）
  CNLINT_API_BASE      接口根地址，默认 https://api.openai.com/v1
  CNLINT_MODEL         模型名，默认 gpt-4o-mini
  CNLINT_TIMEOUT_MS    单次请求超时，默认 30000
  CNLINT_PYTHON        Word 检查所用的 Python 解释器路径

退出码
  0  无 error 级问题
  1  存在 error 级问题
  2  参数或运行错误
`;

/**
 * 解析命令行参数。
 * @param {string[]} argv
 * @returns {object}
 */
export function parseArgs(argv) {
  const opts = {
    targets: [],
    ext: DEFAULT_EXTENSIONS,
    staged: false,
    quiet: false,
    config: null,
    fix: false,
    dryRun: false,
    semantic: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-q':
      case '--quiet':
        opts.quiet = true;
        break;
      case '--staged':
        opts.staged = true;
        break;
      case '-f':
      case '--fix':
        opts.fix = true;
        break;
      case '-n':
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '-s':
      case '--semantic':
        opts.semantic = true;
        break;
      case '-e':
      case '--ext': {
        const value = argv[++i];
        if (!value) throw new Error('--ext 需要一个参数，例如 --ext .md,.txt');
        opts.ext = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      }
      case '-c':
      case '--config': {
        const value = argv[++i];
        if (!value) throw new Error('--config 需要一个路径');
        opts.config = value;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`);
        opts.targets.push(arg);
    }
  }

  return opts;
}

/**
 * 收集待检查文件（相对 cwd 的路径）。
 * @param {object} opts
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function resolveTargets(opts, cwd) {
  if (opts.staged) return stagedFiles(cwd, opts.ext);

  if (opts.targets.length === 0) {
    throw new Error('缺少要检查的文件或目录，试试：cnlint README.md');
  }

  const files = [];
  for (const target of opts.targets) {
    const abs = path.resolve(cwd, target);
    if (await isDirectory(abs)) {
      const found = await collectFiles(abs, opts.ext, { ignore: opts.ignore ?? [] });
      for (const rel of found) files.push(path.join(target, rel));
    } else {
      files.push(target);
    }
  }
  return files;
}

/**
 * 主流程。
 * @param {string[]} argv
 * @param {object} io
 * @returns {Promise<number>} 退出码
 */
export async function run(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();

  // ---- 子命令分发：cnlint docx ... ----
  if (argv[0] === 'docx') {
    return runDocx(argv.slice(1), { stdout, stderr, cwd, ...io });
  }

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr(`cnlint: ${err.message}\n`);
    return 2;
  }

  if (opts.help) {
    stdout(HELP);
    return 0;
  }
  if (opts.version) {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    stdout(`cnlint ${pkg.default.version}\n`);
    return 0;
  }

  let config;
  try {
    config = opts.config
      ? await loadConfigFromFile(opts.config, cwd)
      : await loadConfig(cwd);
  } catch (err) {
    stderr(`cnlint: ${err.message}\n`);
    return 2;
  }
  opts.ignore = config.ignore;

  let files;
  try {
    files = await resolveTargets(opts, cwd);
  } catch (err) {
    stderr(`cnlint: ${err.message}\n`);
    return 2;
  }

  if (files.length === 0) {
    stdout('✅ 没有需要检查的文件\n');
    return 0;
  }

  let totalIssues = 0;
  let errorCount = 0;
  let fixedCount = 0;
  let touchedFiles = 0;
  const reports = [];

  // ---- 语义审校准备（方案 B：规则找嫌疑人，模型定罪） ----
  const semantic = await setupSemantic(opts, io, stderr);
  let semanticConfirmed = 0;
  let semanticRejected = 0;

  for (const rel of files) {
    const abs = path.resolve(cwd, rel);
    const display = path.relative(cwd, abs).split(path.sep).join('/') || rel;

    if (opts.fix) {
      // ---- 修复模式 ----
      let text;
      try {
        const buf = await readFile(abs);
        const binary = detectBinaryType(buf);
        if (binary) {
          stdout(`⏭️  已跳过 ${display}：${binary}\n`);
          continue;
        }
        text = buf.toString('utf8');
      } catch (err) {
        stderr(`cnlint: 无法读取 ${display}：${err.message}\n`);
        continue;
      }

      let { output, fixed, remaining } = fixText(text, { levels: config.levels });

      if (fixed.length > 0) {
        fixedCount += fixed.length;
        touchedFiles += 1;
        if (!opts.dryRun) {
          await writeFile(abs, output, 'utf8');
        }
      }

      if (fixed.length > 0 || remaining.length > 0) {
        reports.push({ display, fixed, remaining, changed: fixed.length > 0 });
      }
      totalIssues += remaining.length;
      errorCount += remaining.filter((i) => i.severity === 'error').length;
      continue;
    }

    // ---- 仅检查模式 ----
    const result = await lintFile(abs, { levels: config.levels });

    if (result.error) {
      if (result.skipped) {
        // 二进制文档不是错误，给出提示即可，不中断也不计入问题数
        stdout(`⏭️  已跳过 ${display}：${result.error}\n`);
      } else {
        stderr(`cnlint: ${result.error}\n`);
      }
      continue;
    }
    if (result.issues.length === 0) continue;

    let issues = result.issues;

    // 语义二次确认：仅对疑似错别字这类需要理解语境的问题
    if (semantic.provider) {
      let text = '';
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        text = '';
      }

      const { confirmed, rejected } = await reviewIssues(issues, text, semantic.provider, {
        onWarn: semantic.onWarn,
      });
      semanticConfirmed += confirmed.filter((i) => i.semanticConfirmed).length;
      semanticRejected += rejected.length;

      // 用审校结果替换原问题：
      // - 非语义类问题（空格、标点等）原样保留
      // - 语义类问题只保留模型确认过的（含模型更新的正确写法）
      issues = mergeSemanticIssues(issues, confirmed, rejected);
    }

    if (issues.length === 0) continue;

    reports.push({ display, issues });
    totalIssues += issues.length;
    errorCount += issues.filter((i) => i.severity === 'error').length;
  }

  stdout(`✅ 校验完成，共扫描 ${files.length} 个文件\n`);

  if (semantic.provider && (semanticConfirmed > 0 || semanticRejected > 0)) {
    const parts = [];
    if (semanticConfirmed > 0) parts.push(`模型确认 ${semanticConfirmed} 处`);
    if (semanticRejected > 0) parts.push(`模型排除 ${semanticRejected} 处误报`);
    stdout(`🤖 语义审校：${parts.join('，')}\n`);
  }

  // ============ 修复模式：报告与修复分两块展示 ============
  if (opts.fix) {
    const fixedReports = reports.filter((r) => (r.fixed ?? []).length > 0);
    const remainingReports = reports.filter((r) => (r.remaining ?? []).length > 0);
    const fixedVerb = opts.dryRun ? '可修复' : '已修复';

    // ---- 第一块：已修复（或 dry-run 下将要修复） ----
    if (fixedReports.length > 0) {
      stdout(`\n🔧 ${fixedVerb} ${fixedCount} 处问题，涉及 ${touchedFiles} 个文件`);
      if (opts.dryRun) stdout('（--dry-run，未写入文件）');
      stdout('\n');
      stdout('─'.repeat(60) + '\n');
      for (const report of fixedReports) {
        for (const issue of report.fixed) {
          stdout(`  🔧 ${report.display}:${issue.line}:${issue.column}\n`);
          stdout(`     ${issue.message}\n`);
          if (!opts.quiet) {
            stdout(`     ${issue.original} → ${issue.suggestion}\n`);
          }
        }
      }
    } else {
      stdout('\n🔧 没有可自动修复的问题\n');
    }

    // ---- 第二块：仍需人工处理 ----
    if (remainingReports.length > 0) {
      const remainingTotal = remainingReports.reduce((n, r) => n + r.remaining.length, 0);
      stdout(`\n⚠️ 仍需人工处理 ${remainingTotal} 处（无法自动修复）\n`);
      stdout('─'.repeat(60) + '\n');
      for (const report of remainingReports) {
        for (const issue of report.remaining) {
          const icon = issue.severity === 'error' ? '❌' : '⚠️';
          stdout(`  ${icon} ${report.display}:${issue.line}:${issue.column}\n`);
          // 消息里若已包含「原文 → 建议」，就不再重复展示
          const inline = issue.message.includes('→');
          stdout(`     ${issue.message}\n`);
          if (!opts.quiet && !inline) {
            stdout(`     ${issue.original} → 建议: ${issue.suggestion}\n`);
          }
        }
      }
    }

    // ---- 小结 ----
    stdout('\n' + '─'.repeat(60) + '\n');
    if (fixedReports.length === 0 && remainingReports.length === 0) {
      stdout('✨ 没有发现任何问题\n');
    } else if (remainingReports.length === 0) {
      stdout(`✨ 全部处理完毕：${fixedVerb} ${fixedCount} 处，无残留\n`);
    } else {
      stdout(`📋 汇总：${fixedVerb} ${fixedCount} 处，仍需人工处理 ${totalIssues} 处\n`);
    }
    return errorCount > 0 ? 1 : 0;
  }

  // ============ 仅检查模式：完整列出全部问题 ============
  if (totalIssues > 0) {
    stdout('\n');
    for (const { display, issues } of reports) {
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        const hint = issue.fixable ? '（可用 --fix 自动修复）' : '（需人工处理）';
        stdout(`${icon} ${display}:${issue.line}:${issue.column}\n`);
        stdout(`   ${issue.message}${hint}\n`);
        if (!opts.quiet) {
          stdout(`   → 原文: ${issue.original}\n`);
          stdout(`   → 建议: ${issue.suggestion}\n`);
        }
        stdout('\n');
      }
    }
    stdout(`共发现 ${totalIssues} 个问题（error ${errorCount} 个）\n`);

    const fixable = reports.reduce(
      (n, r) => n + (r.issues ?? []).filter((i) => i.fixable).length,
      0,
    );
    if (fixable > 0) {
      stdout(`其中 ${fixable} 处可用 --fix 自动修复\n`);
    }
  } else {
    stdout('✨ 没有发现任何问题\n');
  }

  return errorCount > 0 ? 1 : 0;
}

/**
 * 合并语义审校结果。
 *
 * - 非语义类问题（空格、标点等）原样保留
 * - 语义类问题只保留模型确认过的（含模型修正后的正确写法）
 *
 * @param {Array} originalIssues 规则引擎原始结果
 * @param {Array} confirmed 模型确认的问题
 * @param {Array} rejected 模型否定的问题
 * @returns {Array}
 */
export function mergeSemanticIssues(originalIssues, confirmed, rejected) {
  // 1) 非语义类问题（空格、标点、引号等）原样保留
  const result = originalIssues.filter((i) => !isSemanticCandidate(i));

  // 2) 语义类问题：只保留模型确认过的，并优先采用模型修正后的写法
  const confirmedByKey = new Map();
  for (const c of confirmed) {
    confirmedByKey.set(`${c.line}:${c.column}:${c.original}`, c);
  }

  for (const issue of originalIssues) {
    if (!isSemanticCandidate(issue)) continue;
    const key = `${issue.line}:${issue.column}:${issue.original}`;
    const hit = confirmedByKey.get(key);
    // 只有被确认的才保留；被否定的直接丢弃（减少误报）
    if (hit) result.push(hit);
  }

  return result.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * 初始化语义审校（方案 B）。
 *
 * 规则：
 * - 未加 --semantic：完全不启用，行为与纯规则模式一致
 * - 加了 --semantic 但没配密钥：打印提示后自动退回纯规则模式
 * - 初始化异常：同样退回纯规则模式，绝不让检查因模型问题失败
 *
 * @param {object} opts 命令行选项
 * @param {object} io 输出接口
 * @param {Function} stderr 错误输出
 * @returns {Promise<{provider: object|null, onWarn: Function}>}
 */
export async function setupSemantic(opts, io = {}, stderr = () => {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s));
  const onWarn = (msg) => stderr(`cnlint: ${msg}\n`);

  if (!opts.semantic) {
    return { provider: null, onWarn };
  }

  // 测试可注入 provider
  if (io.provider) {
    return { provider: io.provider, onWarn: io.onWarn ?? onWarn };
  }

  const config = configFromEnv(io.env ?? process.env);
  if (!config) {
    stdout('⚠️ 未检测到 CNLINT_API_KEY，语义审校已跳过，按纯规则模式运行\n');
    return { provider: null, onWarn };
  }

  try {
    const raw = createProvider(config, io.fetchImpl ? { fetchImpl: io.fetchImpl } : {});
    const useCache = io.cache ?? createMemoryCache();
    const provider = withCache(raw, useCache);
    return { provider, onWarn, model: config.model };
  } catch (err) {
    onWarn(`语义审校初始化失败，按纯规则模式运行：${err.message}`);
    return { provider: null, onWarn };
  }
}

/**
 * 从指定路径加载配置。
 * @param {string} configPath
 * @param {string} cwd
 */
async function loadConfigFromFile(configPath, cwd) {
  const { readFile } = await import('node:fs/promises');
  const { normalizeConfig } = await import('../src/linter.js');
  const abs = path.resolve(cwd, configPath);
  const text = (await readFile(abs, 'utf8')).replace(/^\uFEFF/, '');
  const raw = JSON.parse(text);
  return { ...normalizeConfig(raw), configDir: path.dirname(abs) };
}

/**
 * Word 文档格式检查子命令。
 *
 * 用法：
 *   cnlint docx <待检测.docx> --spec <格式要求.docx>
 *   cnlint docx <待检测.docx> --rules <rules.json>
 *   cnlint docx <文档.docx> --profile
 *
 * @param {string[]} argv docx 之后的参数
 * @param {object} io
 * @returns {Promise<number>} 退出码
 */
export async function runDocx(argv, io = {}) {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s));
  const stderr = io.stderr ?? ((s) => process.stderr.write(s));

  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    stdout(
      `cnlint docx — Word 文档格式检查与修正

用法
  cnlint docx <待检测.docx> --spec <格式要求.docx>    用另一份文档作为格式标准
  cnlint docx <待检测.docx> --rules <rules.json>      用 JSON 文件写格式要求
  cnlint docx <文档.docx> --profile                   查看文档当前的格式

修正格式
  -f, --fix            自动把不符合要求的格式改成正确的（会先备份原文件）
  -n, --dry-run        配合 --fix：只预览将要做哪些修改，不写入

可检查并修正的项
  中文字体、字号、加粗、对齐方式、行距、段前后间距、首行缩进

示例
  # 1. 先检查，看哪里不符合
  cnlint docx 报告.docx --spec 模板.docx

  # 2. 预览会怎么改
  cnlint docx 报告.docx --spec 模板.docx --fix --dry-run

  # 3. 确认后真正修正（自动备份为 报告.bak.docx）
  cnlint docx 报告.docx --spec 模板.docx --fix

说明
  本功能依赖 Python 与 python-docx，首次使用请执行：
    pip install python-docx

退出码
  0  全部符合要求 / 修正成功
  1  存在不符合的段落（未修正）
  2  参数错误
  3  环境不可用（缺少 Python 或 python-docx）
`,
    );
    return argv.length === 0 ? 2 : 0;
  }

  const target = argv[0];
  let rest = argv.slice(1);

  const doFix = rest.includes('-f') || rest.includes('--fix');
  const dryRun = rest.includes('-n') || rest.includes('--dry-run');

  // 从传给 Python 的参数中剔除 cnlint 自己的开关
  rest = rest.filter((a) => !['-f', '--fix', '-n', '--dry-run'].includes(a));

  // ---- 1) 先检查 ----
  const r = runChecker([target, ...rest], { python: io.python });

  if (r.hints && r.hints.length > 0 && r.code === 3) {
    stderr(`${dependencyHelp(r.hints)}\n`);
    return 3;
  }

  if (r.stdout) stdout(r.stdout);
  if (r.stderr) stderr(r.stderr);

  // 不做修正时，直接透传检查退出码
  if (!doFix) {
    return r.code;
  }

  // ---- 2) 需要修正 ----
  const reportPath = path.resolve(
    path.dirname(path.resolve(target)),
    `${path.basename(target, path.extname(target))}.check.json`,
  );

  if (r.code !== 1) {
    // 没有不符项，或检查本身失败，就没有可修的内容
    if (dryRun) stdout('\n（没有需要修正的内容）\n');
    return r.code;
  }

  stdout('\n' + '─'.repeat(60) + '\n');

  const fixArgs = [target, reportPath];
  if (!dryRun) fixArgs.push('--write');

  const f = runFixer(fixArgs, { python: io.python });

  if (f.code === 3) {
    stderr(`${dependencyHelp(f.hints ?? ['修正脚本执行失败'])}\n`);
    return 3;
  }

  if (f.stdout) stdout(`🔧 ${f.stdout.trim()}\n`);
  if (f.stderr) stderr(f.stderr);

  if (dryRun) {
    stdout('\n提示：以上为预览。确认无误后去掉 --dry-run 即可真正写入。\n');
    return 1;
  }

  // ---- 3) 修正后复检 ----
  stdout('\n' + '─'.repeat(60) + '\n复检中……\n');
  const again = runChecker([target, ...rest], { python: io.python });
  if (again.stdout) stdout(again.stdout);

  return again.code;
}

// 直接执行时运行
const isMain = process.argv[1] && /(^|[\\/])bin[\\/]cnlint\.js$/.test(process.argv[1]);
if (isMain) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`cnlint: ${err.message}\n`);
      process.exit(2);
    });
}