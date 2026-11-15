/**
 * cnlint 程序入口（未处理参数的纯函数部分由 cli.js 负责）。
 */
export { lintText, lintFile, normalizeConfig } from './linter.js';
export { rules, defaultRuleLevels, ruleIds } from './rules.js';
export { collectFiles, loadConfig, stagedFiles } from './files.js';