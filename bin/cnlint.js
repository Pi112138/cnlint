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
import { lintFile } from '../src/linter.js';
import { fixText } from '../src/fixer.js';
import {
  collectFiles,
  loadConfig,
  stagedFiles,
  isDirectory,
  DEFAULT_EXTENSIONS,
} from '../src/files.js';

const HELP = `cnlint — 中文文档排版 & 拼写检查

用法
  cnlint <文件或目录...> [选项]

选项
  -e, --ext <列表>     扫描的扩展名，逗号分隔（默认 .md,.txt）
      --staged         只检查 git 暂存区里的文件
  -f, --fix            自动修复可安全修复的问题并写回文件
  -n, --dry-run        配合 --fix 使用：只显示将要修复的内容，不写文件
  -q, --quiet          只输出汇总，不逐条列出问题
  -c, --config <路径>  指定配置文件（默认向上查找 .cnlintrc.json）
  -v, --version        显示版本
  -h, --help           显示帮助

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

  for (const rel of files) {
    const abs = path.resolve(cwd, rel);
    const display = path.relative(cwd, abs).split(path.sep).join('/') || rel;

    if (opts.fix) {
      // ---- 修复模式 ----
      let text;
      try {
        text = (await readFile(abs, 'utf8'));
      } catch (err) {
        stderr(`cnlint: 无法读取 ${display}：${err.message}\n`);
        continue;
      }

      const { output, fixed, remaining } = fixText(text, { levels: config.levels });

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
      stderr(`cnlint: ${result.error}\n`);
      continue;
    }
    if (result.issues.length === 0) continue;

    reports.push({ display, issues: result.issues });
    totalIssues += result.issues.length;
    errorCount += result.issues.filter((i) => i.severity === 'error').length;
  }

  stdout(`✅ 校验完成，共扫描 ${files.length} 个文件\n`);

  if (opts.fix) {
    if (fixedCount > 0) {
      const verb = opts.dryRun ? '可修复' : '已自动修复';
      stdout(`🔧 ${verb} ${fixedCount} 处问题，涉及 ${touchedFiles} 个文件\n`);
      if (opts.dryRun) {
        stdout('   （--dry-run 模式，未写入文件）\n');
      }
    } else {
      stdout('🔧 没有可自动修复的问题\n');
    }
  }

  if (totalIssues > 0 || reports.some((r) => r.changed)) {
    stdout('\n');
    for (const report of reports) {
      for (const issue of report.fixed ?? []) {
        if (opts.dryRun) {
          stdout(`🔧 ${report.display}:${issue.line}:${issue.column}\n`);
          stdout(`   ${issue.message}\n`);
          if (!opts.quiet) {
            stdout(`   → 原文: ${issue.original}\n`);
            stdout(`   → 修复: ${issue.suggestion}\n`);
          }
          stdout('\n');
        }
      }
      for (const issue of report.remaining ?? report.issues ?? []) {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        stdout(`${icon} ${report.display}:${issue.line}:${issue.column}\n`);
        stdout(`   ${issue.message}（需人工处理）\n`);
        if (!opts.quiet) {
          stdout(`   → 原文: ${issue.original}\n`);
          stdout(`   → 建议: ${issue.suggestion}\n`);
        }
        stdout('\n');
      }
    }
  }

  if (opts.fix) {
    if (totalIssues > 0) {
      stdout(`仍有 ${totalIssues} 个问题需人工处理（error ${errorCount} 个）\n`);
    } else if (fixedCount === 0) {
      stdout('✨ 没有发现任何问题\n');
    } else {
      stdout('✨ 所有可自动修复的问题已处理完毕\n');
    }
  } else if (totalIssues > 0) {
    stdout(`共发现 ${totalIssues} 个问题（error ${errorCount} 个）\n`);
    if (reports.some((r) => r.issues?.some((i) => i.fixable))) {
      stdout('提示：其中部分问题可尝试用 --fix 自动修复\n');
    }
  }

  return errorCount > 0 ? 1 : 0;
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