/**
 * Word 文档格式检查的桥接层。
 *
 * cnlint 主体是零依赖的 Node 工具；Word 格式检查依赖 python-docx，
 * 因此这里负责：
 *   1. 探测哪个 Python 解释器可用且装了 python-docx
 *   2. 调用 scripts/docx/ 下的脚本
 *   3. 在依赖缺失时给出清晰的安装提示，而不是直接崩溃
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 本文件位于 <root>/src/docx/bridge.js，上溯两级即项目根
const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts', 'docx');
const CHECKER = path.join(SCRIPTS_DIR, 'check_docx_format.py');

/** 常见候选解释器名，按优先级 */
const CANDIDATES = [
  process.env.CNLINT_PYTHON, // 用户显式指定
  'python',
  'python3',
  'py',
];

/**
 * 在系统 PATH 里探测可用的 Python 解释器（不校验依赖）。
 * @returns {string[]} 可执行的候选列表
 */
export function findPythons(candidates = CANDIDATES) {
  const found = [];
  for (const exe of candidates) {
    if (!exe) continue;
    try {
      const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000 });
      if (r.status === 0) found.push(exe);
    } catch {
      // 忽略不可用的候选
    }
  }
  return [...new Set(found)];
}

/**
 * 判断某个解释器是否装了 python-docx。
 * @param {string} exe
 * @returns {{ ok: boolean, version?: string, error?: string }}
 */
export function hasPythonDocx(exe) {
  try {
    const r = spawnSync(exe, ['-c', 'import docx; print(docx.__version__ if hasattr(docx, "__version__") else "ok")'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    if (r.status === 0) {
      return { ok: true, version: (r.stdout || '').trim() };
    }
    return { ok: false, error: (r.stderr || '').trim().split('\n').pop() || 'import docx 失败' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * 找到第一个同时满足「Python 可用」和「装了 python-docx」的解释器。
 * @returns {{ exe: string|null, pythonFound: string[], hints: string[] }}
 */
export function resolvePython() {
  const pythons = findPythons();
  const hints = [];

  if (pythons.length === 0) {
    hints.push('系统中未找到 Python。请先安装 Python 3.8+（https://www.python.org/downloads/）');
    return { exe: null, pythonFound: [], hints };
  }

  for (const exe of pythons) {
    const check = hasPythonDocx(exe);
    if (check.ok) {
      return { exe, pythonFound: pythons, hints };
    }
    hints.push(`Python「${exe}」缺少 python-docx（${check.error}）`);
  }

  hints.push('请任选一个 Python 执行：pip install python-docx');
  return { exe: null, pythonFound: pythons, hints };
}

/**
 * 调用 Python 检查脚本。
 *
 * @param {string[]} args 传给脚本的参数
 * @param {object} [options]
 * @returns {{ ok: boolean, code: number, stdout: string, stderr: string, hints?: string[] }}
 */
export function runChecker(args, options = {}) {
  const { exe, hints } = options.python ? { exe: options.python, hints: [] } : resolvePython();

  if (!exe) {
    return { ok: false, code: 3, stdout: '', stderr: '未找到可用的 Python 环境', hints };
  }

  const r = spawnSync(exe, [CHECKER, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  return {
    ok: r.status === 0,
    code: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

/**
 * 生成依赖缺失时的友好提示。
 * @param {string[]} hints
 * @returns {string}
 */
export function dependencyHelp(hints) {
  const lines = ['cnlint: Word 格式检查需要 Python 环境，但当前不可用。', ''];
  for (const h of hints) lines.push(`  · ${h}`);
  lines.push('');
  lines.push('安装步骤：');
  lines.push('  1. 安装 Python 3.8 或更高版本：https://www.python.org/downloads/');
  lines.push('  2. 安装依赖：pip install python-docx');
  lines.push('  3. 重新运行：cnlint docx <文档.docx> --spec <格式要求.docx>');
  lines.push('');
  lines.push('如果 Python 已装但不在 PATH 中，可用环境变量指定：');
  lines.push('  set CNLINT_PYTHON=C:\\path\\to\\python.exe');
  return lines.join('\n');
}