# cnlint
<div align="center">

**中文文档轻量排版 & 拼写检查 Lint 工具**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Version](https://img.shields.io/badge/version-0.1.0-orange)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)]()
[![CI](https://img.shields.io/badge/CI-passing-success.svg)]()

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

### 安装
```bash
# 全局安装
npm install -g cnlint
用法
bash
# 检查单个文件
cnlint README.md

# 扫描整个目录下所有 md / txt 文档
cnlint ./docs/ --ext .md,.txt
输出示例
text
✅ 校验完成，共扫描 3 个文件

⚠️ docs/intro.md:12:5
   中英文缺少空格
   → 原文: 使用cnlint工具
   → 修复: 使用 cnlint 工具

⚠️ README.md:26:12
   正文误用半角引号
   → 原文: "示例"
   → 推荐: “示例”
🔧 高级配置
在项目根目录新建 .cnlintrc.json 自定义规则：

json
{
  "rules": {
    "space-between-cn-en": "error",
    "no-duplicate-punctuation": "warn",
    "quotes": "error"
  },
  "ignore": ["node_modules/**", "CHANGELOG.md"]
}
🤖 CI / Git Hook 集成
在 .github/workflows/lint.yml 中加入：

yaml
- name: Run cnlint
  run: npx cnlint ./docs/
或配合 husky 在提交前自动检查：

bash
npx husky add .husky/pre-commit "npx cnlint --staged"
📖 遵循规范
《中文技术文档排版规范》

《GB/T 15834-2011 标点符号用法》

🤝 贡献指南
欢迎提交 Issue 反馈规则漏洞、新增错别字词库、提出排版规则优化。
