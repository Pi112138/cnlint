# cnlint

<div align="center">

**中文文档轻量排版 & 拼写检查 Lint 工具**

[![CI](https://github.com/Pi112138/cnlint/actions/workflows/ci.yml/badge.svg)](https://github.com/Pi112138/cnlint/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-orange.svg)](https://github.com/Pi112138/cnlint/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Pi112138/cnlint/pulls)

</div>

> 面向 Markdown / 技术文档 / 知识库，一键统一中文排版规范，自动排查错别字与标点问题。

## ✨ 简介

撰写中文技术文档、README、博客、产品文档时，经常出现大量细碎排版问题：中英文缺空格、全半角标点混用、引号格式错乱、重复标点、错别字等。

这类问题**不影响代码运行，但直接拉低文档专业度**。

**cnlint** 专为中文场景定制，轻量无依赖、开箱即用，支持本地批量扫描，可接入 Git Hook / CI 流水线自动校验，帮助团队统一中文文档规范。

## 🚀 核心能力

- ✅ **中英文混排校验**：检测中文与英文、数字之间缺失的空格，遵循《中文技术文档排版规范》
- ✅ **重复标点检测**：捕获连续逗号、句号、问号等手误叠标点（如 `，，`、`？？`）
- ✅ **中文引号规范化**：检测中文正文中误用的半角双引号 `"示例"`，建议改为 `“示例”`
- ✅ **全角标点误用识别**：识别英文语境中的全角标点，如 `hello，world`
- ✅ **常见错别字检测**：内置 200+ 条高频错别字词典（如 `按装`→`安装`、`再接再励`→`再接再厉`），附误报白名单
- ✅ **一键自动修复**：`--fix` 可安全修复缺空格、重复标点、半角引号，其余问题保留待人工确认
- ✅ **自动跳过代码**：围栏代码块与行内代码不参与检查，避免误报；URL 与链接目标不受影响
- ✅ **Markdown 结构感知**：识别标题/列表/引用/表格/加粗等结构，跳过语法标记只检查正文
- ✅ **轻量易集成**：零第三方依赖，支持目录批量扫描与 `--staged`，可嵌入 Git Hook / CI

## 🎯 解决痛点

1. **人工成本高**：人工校对长文档成本极高，极易遗漏细微的格式问题。
2. **协作难统一**：多人协作文档排版风格五花八门，缺乏统一的自动化规范。
3. **生态不友好**：通用 Lint 工具（如 ESLint、textlint）对中文排版原生支持差、配置繁琐冗余。

## 📦 快速上手

### 环境要求

- Node.js >= 18（本项目零第三方依赖，无需 `npm install`）

### 使用

从 npm 安装（包名带作用域，安装后命令仍为 `cnlint`）：

```bash
npm install -g @pi112138/cnlint

cnlint README.md
```

或从源码运行（零第三方依赖，无需 `npm install`）：

```bash
git clone https://github.com/Pi112138/cnlint.git
cd cnlint

# 检查单个文件
node ./bin/cnlint.js README.md

# 扫描整个目录下的 md / txt 文档
node ./bin/cnlint.js ./docs/ --ext .md,.txt
```

也可以用 `npx` 免安装临时运行：

```bash
npx @pi112138/cnlint ./docs/
```

### 自动修复

加上 `--fix` 可自动修复「答案唯一」的问题（缺空格、重复标点、中文正文半角引号）：

```bash
# 预览将要修改的内容，不写入文件
node ./bin/cnlint.js ./docs/ --fix --dry-run

# 实际写入修复结果
node ./bin/cnlint.js ./docs/ --fix
```

效果示例：

```text
✅ 校验完成，共扫描 1 个文件
🔧 已自动修复 5 处问题，涉及 1 个文件

⚠️ docs/a.md:15:9
   英文语境中误用全角标点（需人工处理）
   → 原文: ，
   → 建议: ,

仍有 1 个问题需人工处理（error 0 个）
```

修复前后对比：

| 修复前 | 修复后 |
|---|---|
| `使用cnlint工具` | `使用 cnlint 工具` |
| `很好，，但是` | `很好，但是` |
| `这是"示例"` | `这是“示例”` |

⚠️ 出于安全考虑，以下内容**不会被 `--fix` 自动修改**：

- 围栏代码块与行内代码中的文本
- URL 与 Markdown 链接目标
- 存在歧义的问题（如「英文语境全角标点」）——只提示、不自动改

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
| `-f, --fix` | 自动修复可安全修复的问题并写回文件 |
| `-n, --dry-run` | 配合 `--fix`：只显示将要修复的内容，不写文件 |
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
| `spelling` | `warn` | 常见中文错别字，如 `按装`→`安装` |

### 错别字词典

`spelling` 规则基于内置词典（`src/dict.js`，200+ 条），收录原则偏保守：

- **只收「任何语境下都错」的组合**，如 `按装`→`安装`、`再接再励`→`再接再厉`
- **不收「的地得」等需语法判断的用法错误**
- **不收用法辨析类**，如 `权力/权利`、`反应/反映`
- **不收专有名词**可能命中的组合
- 附**误报白名单**，如 `坐位体前屈`（体育项目名）、`按装订顺序`

错别字问题**只报告、不自动修复**（`--fix` 不会改动），避免误改原文。

### Markdown 结构感知

工具会识别每行的 Markdown 结构，**只检查正文内容，跳过语法标记**，因此不会把 `#`、`-`、`>`、`|`、`**` 等符号当成文档内容：

| 结构 | 处理方式 |
|---|---|
| 标题 `# 标题` | 跳过 `#` 标记，检查标题文字 |
| 列表 `- 项` / `1. 项` | 跳过列表符号，检查条目内容 |
| 引用 `> 内容` | 跳过 `>` 标记，检查引用文字 |
| 表格 `\| a \| b \|` | 跳过竖线，逐单元格检查 |
| 表格分隔行 `\|---\|` | 整行跳过 |
| 加粗/斜体 `**文字**` | 跳过 `**` 符号，检查文字 |
| 链接 `[文字](url)` | **跳过 URL**，但检查链接文字 |
| 图片 `![alt](url)` | 跳过 URL |
| 水平分隔线 `---`、`***` | 整行跳过 |
| HTML 标签行 | 整行跳过 |

随手写一段带结构的文档即可验证，`--fix` 同样会把列表符号、标题前缀、表格竖线、加粗标记原样保留：

- 修复前：`## 使用cnlint工具`
- 修复后：`## 使用 cnlint 工具`（`##` 不受影响）

### 自动跳过的内容

以下内容不会被规则检查，避免误报：

- 围栏代码块（` ``` ` 与 `~~~`）内的所有行
- 行内代码 `` `code` `` 覆盖的区间
- 链接与图片的 URL、裸链接、邮箱地址
- 上表列出的各类 Markdown 语法标记本身

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
├── bin/cnlint.js          # 命令行入口（参数解析、输出、退出码、--fix）
├── src/
│   ├── index.js           # 对外导出的 API
│   ├── linter.js          # 检查器：逐行应用规则、配置归一化、glob 匹配
│   ├── fixer.js           # 修复器：安全应用替换、保留换行风格
│   ├── rules.js           # 规则集合（含 fixable 标记与 URL 保护）
│   ├── dict.js            # 常见错别字词典与误报白名单（200+ 条）
│   ├── text.js            # 行切分、Markdown 结构识别、代码块与行内代码定位
│   └── files.js           # 文件发现、配置向上查找、--staged 支持
├── test/
│   ├── linter.test.js     # 规则与检查器测试
│   ├── fixer.test.js      # 自动修复测试
│   ├── spelling.test.js   # 错别字词典测试（含全量自洽校验）
│   └── markdown.test.js   # Markdown 结构感知测试
└── .cnlintrc.example.json # 配置文件示例
```

## 🧪 开发与测试

```bash
# 运行自动化测试（72 个用例）
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