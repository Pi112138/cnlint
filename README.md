# cnlint

<div align="center">

**中文文档轻量排版 & 拼写检查 Lint 工具**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](#-许可证)
[![Version](https://img.shields.io/badge/version-0.1.0-orange)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Pi112138/cnlint/pulls)

</div>

> 面向 Markdown / 技术文档 / 知识库，一键统一中文排版规范，自动排查错别字与标点问题。

## ✨ 简介

撰写中文技术文档、README、博客、产品文档时，经常出现大量细碎排版问题：中英文缺空格、全半角标点混用、引号格式错乱、重复标点、错别字等。

这类问题**不影响代码运行，但直接拉低文档专业度**。

**cnlint** 专为中文场景定制，轻量无依赖、开箱即用，支持本地批量扫描，可接入 Git Hook / CI 流水线自动校验，帮助团队统一中文文档规范。

## 🚀 核心能力

- ✅ **中英文混排校验**：中文与英文、数字之间空格规范检测（缺空格/多余空格），遵循《中文技术文档排版规范》
- ✅ **全角/半角标点识别**：区分正文与代码片段上下文，自动识别标点错用
- ✅ **重复标点检测**：捕获连续逗号、句号、问号等手误叠标点
- ✅ **中文引号规范化**：强制区分直角引号、弯引号，正文统一使用 `“ ” ‘ ’`
- ✅ **基础中文拼写纠错**：内置常用词库，识别形近字、高频错别字
- ✅ **轻量易集成**：支持目录批量扫描，适配 Markdown / txt，可嵌入提交自动化检查

## 🎯 解决痛点

1. **人工成本高**：人工校对长文档成本极高，极易遗漏细微的格式问题。
2. **协作难统一**：多人协作文档排版风格五花八门，缺乏统一的自动化规范。
3. **生态不友好**：通用 Lint 工具（如 ESLint、textlint）对中文排版原生支持差、配置繁琐冗余。

## 📦 快速上手

### 环境要求

- Node.js >= 18（本项目零第三方依赖，无需 `npm install`）

### 使用

从源码运行：

```bash
git clone https://github.com/Pi112138/cnlint.git
cd cnlint

# 检查单个文件
node ./bin/cnlint.js README.md

# 扫描整个目录下的 md / txt 文档
node ./bin/cnlint.js ./docs/ --ext .md,.txt
```

如需全局 `cnlint` 命令，可先在本仓库内建立链接：

```bash
npm link          # 之后即可直接使用 cnlint 命令
```

### 输出示例

```text
✅ 校验完成，共扫描 3 个文件

❌ docs/intro.md:12:5
   中英文之间缺少空格
   → 原文: 用c
   → 修复: 用 c

⚠️ README.md:26:12
   正文误用半角双引号
   → 原文: "示例"
   → 修复: “示例”

共发现 2 个问题（error 1 个）
```

### 命令行选项

| 选项 | 说明 |
|---|---|
| `-e, --ext <列表>` | 扫描的扩展名，逗号分隔（默认 `.md,.txt`） |
| `--staged` | 只检查 git 暂存区里的文件（适合 pre-commit） |
| `-q, --quiet` | 只输出汇总，不逐条列出问题 |
| `-c, --config <路径>` | 指定配置文件（默认从当前目录向上查找 `.cnlintrc.json`） |
| `-v, --version` | 显示版本 |
| `-h, --help` | 显示帮助 |

### 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 无 error 级问题 |
| `1` | 存在 error 级问题 |
| `2` | 参数或运行错误（如配置文件非法） |

## 🔧 高级配置

在项目根目录新建 `.cnlintrc.json` 自定义规则（可直接复制 `.cnlintrc.example.json`）：

```json
{
  "rules": {
    "space-between-cn-en": "error",
    "no-duplicate-punctuation": "warn",
    "quotes": "error",
    "fullwidth-punct-in-latin": "warn"
  },
  "ignore": ["node_modules/**", "CHANGELOG.md"]
}
```

规则级别可选 `error`、`warn`、`off`（或 `false`，表示关闭）。

### 内置规则

| 规则 ID | 默认级别 | 说明 |
|---|---|---|
| `space-between-cn-en` | `error` | 中文与英文/数字之间缺空格 |
| `no-duplicate-punctuation` | `warn` | 连续重复的中文标点，如 `，，`、`？？` |
| `quotes` | `error` | 中文正文误用半角双引号 `"示例"` |
| `fullwidth-punct-in-latin` | `warn` | 英文语境中误用全角标点，如 `hello，world` |

### 自动跳过的内容

以下内容不会被规则检查，避免误报：

- 围栏代码块（` ``` ` 与 `~~~`）内的所有行
- 行内代码 `` `code` `` 覆盖的区间

## 🤖 CI / Git Hook 集成

### GitHub Actions

在 `.github/workflows/lint.yml` 中加入：

```yaml
name: lint

on: [push, pull_request]

jobs:
  cnlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run cnlint
        run: node ./bin/cnlint.js ./docs/ --ext .md
```

### Git Hook

配合 husky 在提交前自动检查暂存区文档：

```bash
npx husky add .husky/pre-commit "node ./bin/cnlint.js --staged"
```

## 🗂 项目结构

```text
cnlint/
├── bin/cnlint.js          # 命令行入口（参数解析、输出、退出码）
├── src/
│   ├── index.js           # 对外导出的 API
│   ├── linter.js          # 检查器：逐行应用规则、配置归一化、glob 匹配
│   ├── rules.js           # 规则集合
│   ├── text.js            # 行切分、代码块与行内代码定位
│   └── files.js           # 文件发现、配置向上查找、--staged 支持
├── test/linter.test.js    # 基于 node:test 的自动化测试
└── .cnlintrc.example.json # 配置文件示例
```

## 🧪 开发与测试

```bash
# 运行自动化测试（14 个用例）
npm test

# 自检本项目文档
node ./bin/cnlint.js README.md
```

## 📖 遵循规范

- [《中文技术文档排版规范》](https://github.com/sparanoid/chinese-copywriting-guidelines)
- 《GB/T 15834-2011 标点符号用法》

## 🤝 贡献指南

欢迎提交 Issue 反馈规则漏洞、新增错别字词库、提出排版规则优化。

1. Fork 本仓库并新建特性分支：`git checkout -b feat/my-rule`
2. 提交改动：`git commit -m "feat: add my rule"`
3. 推送分支并发起 Pull Request

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。