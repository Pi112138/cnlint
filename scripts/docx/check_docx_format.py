"""
文档格式检查器。

用途：用户提供两份 Word 文档
    1. 格式要求文档（标准示例，规定了各级标题/正文该长什么样）
    2. 待检测文档（需要检查的对象）

工具从「格式要求文档」中提取基准格式，再逐段检查「待检测文档」，
把不符合的地方精确标出来。

也可以用一个 JSON 规则文件代替「格式要求文档」，直接从文本写要求。
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

# 确保无论从哪个工作目录调用，都能导入同目录的 format_profile
sys.path.insert(0, str(Path(__file__).resolve().parent))

from format_profile import extract_format, summarize, ParaFormat

# 参与比较的字段与中文名
FIELDS = {
    "font_name": "中文字体",
    "font_size": "字号(pt)",
    "bold": "加粗",
    "alignment": "对齐",
    "line_spacing": "行距(倍)",
    "space_before": "段前(pt)",
    "space_after": "段后(pt)",
    "first_line_indent": "首行缩进(字符)",
}

# 容差
TOLERANCE = {
    "font_size": 0.6,
    "line_spacing": 0.11,
    "space_before": 1.0,
    "space_after": 1.0,
    "first_line_indent": 0.15,
}

LEVEL_NAMES = {
    0: "一级标题",
    1: "二级标题",
    2: "三级标题",
    3: "四级标题",
    4: "五级标题",
}


@dataclass
class Mismatch:
    para_index: int
    text: str
    role: str            # 一级标题 / 正文 ...
    field: str           # 字段中文名
    expected: object
    actual: object


@dataclass
class ParaCheck:
    index: int
    text: str
    role: str
    ok: bool
    mismatches: list


def _fmt_value(field_name: str, value) -> str:
    if value is None:
        return "未设置"
    if field_name == "bold":
        return "是" if value else "否"
    if field_name == "alignment":
        return {"left": "左对齐", "center": "居中", "right": "右对齐",
                "justify": "两端对齐", None: "未设置"}.get(value, str(value))
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def _equal(field_name: str, expected, actual) -> bool:
    if expected is None:
        return True  # 基准未规定该字段，不检查
    if field_name == "bold":
        return bool(expected) == bool(actual)
    if field_name == "alignment":
        if actual is None:
            return True  # 未设置视为默认，不判错
        return expected == actual
    if field_name in TOLERANCE:
        if actual is None:
            # 基准要求了具体值而实际未设置，判为不符
            return False
        return abs(float(expected) - float(actual)) <= TOLERANCE[field_name]
    return str(expected) == str(actual)


def build_rules_from_docx(spec_path: str) -> dict:
    """从「格式要求文档」提取规则。"""
    paras = extract_format(spec_path)
    summary = summarize(paras)

    rules = {"headings": {}, "body": None, "source": f"DOCX:{Path(spec_path).name}"}

    for level, fmt in summary["headings"].items():
        rules["headings"][int(level)] = {k: fmt.get(k) for k in FIELDS}

    body = summary["body"]
    if body:
        rules["body"] = {k: body.get(k) for k in FIELDS}

    return rules


def build_rules_from_json(json_path: str) -> dict:
    """从 JSON 文件读取规则。"""
    # utf-8-sig 可兼容 Windows 记事本 / PowerShell 写入的 BOM
    with open(json_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    rules = {"headings": {}, "body": None, "source": f"JSON:{Path(json_path).name}"}

    def norm(entry: dict) -> dict:
        out = {}
        # 先取内部字段名（下划线风格）
        for k in FIELDS:
            if k in entry:
                out[k] = entry[k]

        # 再取用户友好的别名（含驼峰写法），别名优先级更高
        aliases = {
            "font": "font_name",
            "size": "font_size",
            "indent": "first_line_indent",
            "alignment": "alignment",
            "lineSpacing": "line_spacing",
            "line_spacing": "line_spacing",
            "spaceBefore": "space_before",
            "space_before": "space_before",
            "spaceAfter": "space_after",
            "space_after": "space_after",
            "bold": "bold",
        }
        for src, dst in aliases.items():
            if src in entry:
                out[dst] = entry[src]

        return out

    for key, value in (data.get("headings") or {}).items():
        rules["headings"][int(key)] = norm(value)

    if data.get("body"):
        rules["body"] = norm(data["body"])

    return rules


def check(target_path: str, rules: dict) -> dict:
    """按规则检查目标文档。"""
    paras = extract_format(target_path)

    results: list[ParaCheck] = []
    total_mismatch = 0
    ok_count = 0

    for p in paras:
        if not p.text:
            continue

        if p.is_heading and p.outline_level in rules["headings"]:
            expected = rules["headings"][p.outline_level]
            role = LEVEL_NAMES.get(p.outline_level, f"{p.outline_level + 1}级标题")
        elif not p.is_heading and rules.get("body"):
            expected = rules["body"]
            role = "正文"
        else:
            # 没有对应规则的段落跳过
            continue

        mismatches = []
        for field_name, label in FIELDS.items():
            exp = expected.get(field_name)
            act = getattr(p, field_name, None)
            if not _equal(field_name, exp, act):
                mismatches.append(
                    Mismatch(p.index, p.text, role, label, exp, act)
                )

        if mismatches:
            total_mismatch += len(mismatches)
        else:
            ok_count += 1

        results.append(
            ParaCheck(
                index=p.index,
                text=p.text,
                role=role,
                ok=not mismatches,
                mismatches=mismatches,
            )
        )

    return {
        "target": Path(target_path).name,
        "source": rules.get("source"),
        "paragraphs_checked": len(results),
        "paragraphs_ok": ok_count,
        "paragraphs_bad": len(results) - ok_count,
        "total_mismatches": total_mismatch,
        "results": results,
    }


def format_report(rep: dict) -> str:
    """生成可读报告。"""
    lines = []
    lines.append("=" * 68)
    lines.append("文档格式检查报告")
    lines.append("=" * 68)
    lines.append(f"格式要求来源：{rep['source']}")
    lines.append(f"待检测文档：  {rep['target']}")
    lines.append("")
    lines.append(
        f"共检查 {rep['paragraphs_checked']} 段："
        f"✅ 符合 {rep['paragraphs_ok']} 段，"
        f"❌ 不符合 {rep['paragraphs_bad']} 段"
        f"（差异 {rep['total_mismatches']} 处）"
    )
    lines.append("")

    for r in rep["results"]:
        head = f"第 {r.index} 段 [{r.role}] 「{r.text}」"
        if r.ok:
            lines.append(f"✅ {head}")
        else:
            lines.append(f"❌ {head}")
            for m in r.mismatches:
                lines.append(
                    f"     · {m.field}：实际 {_fmt_value(m.field, m.actual)}"
                    f"  →  应为 {_fmt_value(m.field, m.expected)}"
                )
        lines.append("")

    if rep["paragraphs_bad"] == 0:
        lines.append("结论：全部符合格式要求 ✅")
    else:
        lines.append(f"结论：有 {rep['paragraphs_bad']} 段不符合要求，需修改")

    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "用法:\n"
            "  # 用另一份 Word 文档作为格式标准\n"
            "  python check_docx_format.py <待检测.docx> --spec <格式要求.docx>\n\n"
            "  # 用 JSON 规则文件\n"
            "  python check_docx_format.py <待检测.docx> --rules rules.json\n\n"
            "  # 只查看某文档的格式画像\n"
            "  python check_docx_format.py <文档.docx> --profile\n",
            file=sys.stderr,
        )
        return 2

    target = argv[1]
    args = argv[2:]

    if "--profile" in args:
        paras = extract_format(target)
        print(json.dumps(summarize(paras), ensure_ascii=False, indent=2))
        return 0

    if "--spec" in args:
        i = args.index("--spec")
        spec = args[i + 1]
        rules = build_rules_from_docx(spec)
    elif "--rules" in args:
        i = args.index("--rules")
        rules = build_rules_from_json(args[i + 1])
    else:
        print("缺少 --spec 或 --rules 参数", file=sys.stderr)
        return 2

    rep = check(target, rules)
    print(format_report(rep))

    # 同时写一份 JSON，便于后续自动修改
    out = Path(target).with_suffix(".check.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(
            {
                "target": rep["target"],
                "source": rep["source"],
                "paragraphs_ok": rep["paragraphs_ok"],
                "paragraphs_bad": rep["paragraphs_bad"],
                "total_mismatches": rep["total_mismatches"],
                "details": [
                    {
                        "index": r.index,
                        "role": r.role,
                        "text": r.text,
                        "mismatches": [asdict(m) for m in r.mismatches],
                    }
                    for r in rep["results"]
                    if not r.ok
                ],
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"\n明细已写入：{out}")

    return 1 if rep["paragraphs_bad"] > 0 else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))