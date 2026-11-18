"""
按检查结果自动修正 Word 文档格式。

读取 check_docx_format.py 生成的 JSON 明细，把不符合要求的段落
改成规则要求的样子。

安全设计：
    - 默认只预览（dry-run），加 --write 才真正写入
    - 写入前自动备份原文件
    - 中文字体同时写 eastAsia，否则 Word 不生效
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH

# 字段中文名 -> 内部字段名
FIELD_MAP = {
    "中文字体": "font_name",
    "字号(pt)": "font_size",
    "加粗": "bold",
    "对齐": "alignment",
    "行距(倍)": "line_spacing",
    "段前(pt)": "space_before",
    "段后(pt)": "space_after",
    "首行缩进(字符)": "first_line_indent",
}

ALIGN_MAP = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}


def set_eastasia_font(run, name: str):
    """设置中文字体。必须同时写 w:eastAsia，否则 Word 不认。"""
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), name)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)


def apply_to_paragraph(paragraph, field: str, value, target_size=None):
    """
    把一项格式应用到段落。

    返回 True 表示已处理，False 表示该字段暂不支持自动修复。

    原则：字号/字体/加粗尽量作用到段落内所有 run，
    这样段落里混排的多个 run 都能被统一。
    """
    if field == "font_name":
        for run in paragraph.runs:
            set_eastasia_font(run, str(value))
        # 空段落没有 run，无法设置字符格式
        return bool(paragraph.runs)

    if field == "font_size":
        old_size = None
        if paragraph.runs and paragraph.runs[0].font.size:
            old_size = paragraph.runs[0].font.size.pt

        for run in paragraph.runs:
            run.font.size = Pt(float(value))

        # 字号变化后，按「字符」表示的首行缩进会随之改变实际宽度。
        # 例如 10.5pt 下 2 字符 = 420twips；改成 12pt 后 420twips 只剩 1.75 字符。
        # 这里把缩进按同样的字符数重新换算，保持视觉缩进一致。
        if old_size and paragraph.runs:
            ppr = paragraph._element.find(qn("w:pPr"))
            ind = ppr.find(qn("w:ind")) if ppr is not None else None
            if ind is not None and ind.get(qn("w:firstLine")) is not None:
                try:
                    chars = (int(ind.get(qn("w:firstLine"))) / 20.0) / old_size
                    ind.set(
                        qn("w:firstLine"),
                        str(int(round(chars * float(value) * 20))),
                    )
                except Exception:
                    pass

        return bool(paragraph.runs)

    if field == "bold":
        for run in paragraph.runs:
            run.font.bold = bool(value)
        return bool(paragraph.runs)

    if field == "alignment":
        paragraph.paragraph_format.alignment = ALIGN_MAP.get(str(value))
        return True

    if field == "line_spacing":
        paragraph.paragraph_format.line_spacing = float(value)
        return True

    if field == "space_before":
        paragraph.paragraph_format.space_before = Pt(float(value))
        return True

    if field == "space_after":
        paragraph.paragraph_format.space_after = Pt(float(value))
        return True

    if field == "first_line_indent":
        # 首行缩进以「字符」为单位，换算依据是目标字号：
        #     1 字符 = 字号(pt) pt = 字号 × 20 twips
        # 例：12pt 字体缩进 2 字符 → 24pt → 480 twips（与 Word 显示一致）
        ppr = paragraph._element.get_or_add_pPr()
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            ind = ppr.makeelement(qn("w:ind"), {})
            ppr.append(ind)

        size = target_size
        if size is None and paragraph.runs and paragraph.runs[0].font.size:
            size = paragraph.runs[0].font.size.pt
        if size is None:
            size = 12.0

        twips = int(round(float(value) * float(size) * 20))
        ind.set(qn("w:firstLine"), str(twips))
        # firstLineChars 仅供 Word 界面参考，读取时不依赖它
        ind.set(qn("w:firstLineChars"), str(int(round(float(value) * 100))))
        return True

    return False


def fix_document(docx_path: str, report_path: str, write: bool = False):
    """
    按报告修正文档。

    @returns (applied, unsupported, message)
    """
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    details = report.get("details") or []

    if not details:
        return 0, 0, "没有需要修正的内容"

    document = Document(docx_path)
    paragraphs = document.paragraphs

    applied = 0
    unsupported = 0
    changes = []

    for item in details:
        idx = item.get("index")
        if not isinstance(idx, int) or idx < 1 or idx > len(paragraphs):
            continue
        paragraph = paragraphs[idx - 1]

        mismatches = item.get("mismatches", [])

        # 关键：先应用字号、再处理缩进。
        # 首行缩进以「字符」为单位，需要乘以当前字号换算成 pt，
        # 若先改缩进后改字号，换算会用旧字号导致偏差（如 2 字符算成 1.75）。
        def sort_key(mm):
            f = FIELD_MAP.get(mm.get("field"), "")
            # 字号最优先，缩进最后
            order = {"font_size": 0, "font_name": 1, "bold": 2,
                     "alignment": 3, "space_before": 4, "space_after": 5,
                     "line_spacing": 6, "first_line_indent": 9}
            return order.get(f, 5)

        for mm in sorted(mismatches, key=sort_key):
            field_cn = mm.get("field")
            field = FIELD_MAP.get(field_cn)
            expected = mm.get("expected")

            if field is None or expected is None:
                unsupported += 1
                changes.append(f"  ⚠️ 第 {idx} 段：{field_cn} 暂不支持自动修复")
                continue

            # 本段若同时要改字号，缩进换算以目标字号为准
            target_size = None
            for other in mismatches:
                if FIELD_MAP.get(other.get("field")) == "font_size" and other.get("expected"):
                    target_size = float(other["expected"])
                    break

            ok = apply_to_paragraph(paragraph, field, expected, target_size)
            if ok:
                applied += 1
                changes.append(
                    f"  🔧 第 {idx} 段：{field_cn} "
                    f"{mm.get('actual')} → {expected}"
                )
            else:
                unsupported += 1
                changes.append(f"  ⚠️ 第 {idx} 段：{field_cn} 无法应用（段落内无文本）")

    if write and applied > 0:
        # 备份原文件
        backup = Path(docx_path).with_suffix(".bak.docx")
        shutil.copy2(docx_path, backup)
        document.save(docx_path)
        message = f"已修正 {applied} 处，已写入 {docx_path}（原文件备份为 {backup.name}）"
    elif applied > 0:
        message = f"可修正 {applied} 处（预览模式，未写入文件）"
    else:
        message = "没有可自动修正的内容"

    return applied, unsupported, "\n".join(changes) + "\n" + message


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "用法: python fix_docx_format.py <文档.docx> <检查报告.json> [--write]",
            file=sys.stderr,
        )
        return 2

    docx_path = argv[1]
    report_path = argv[2]
    write = "--write" in argv

    applied, unsupported, msg = fix_document(docx_path, report_path, write)
    print(msg)

    return 0 if applied >= 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))