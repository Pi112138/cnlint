"""
从 Word 文档中提取每个段落的「实际生效格式」。

关键点：Word 的格式是多层继承的
    直接格式 (run.font) → 字符样式 → 段落样式 → 文档默认

只看 run.font.size 会得到 None（因为多数文档不直接设置），
因此这里逐层回退，直到拿到真正渲染时生效的值。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Optional

from docx import Document
from docx.shared import Pt, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH

# WML 命名空间
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@dataclass
class ParaFormat:
    """一个段落的实际格式。"""

    index: int                      # 段落序号（从 1 开始，含空段）
    text: str                       # 段落文本（截断展示）
    style: Optional[str]            # 段落样式名
    outline_level: Optional[int]    # 大纲级别（0=一级标题，None=正文）
    is_heading: bool

    font_name: Optional[str]        # 中文字体（eastAsia 优先）
    font_name_latin: Optional[str]  # 西文字体
    font_size: Optional[float]      # 字号 pt
    bold: Optional[bool]
    italic: Optional[bool]

    alignment: Optional[str]        # left/center/right/justify
    line_spacing: Optional[float]   # 行距（倍数）
    space_before: Optional[float]   # 段前 pt
    space_after: Optional[float]    # 段后 pt
    first_line_indent: Optional[float]  # 首行缩进 字符数


def _pt(value) -> Optional[float]:
    """把 Length 转成 pt。"""
    if value is None:
        return None
    try:
        return round(float(value.pt), 2)
    except Exception:
        return None


def _twips_to_pt(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(value / 20.0, 2)
    except Exception:
        return None


def _resolve_eastasia_font(run, style_stack) -> Optional[str]:
    """获取中文字体：run 直接设置 > rPr/rFonts eastAsia > 样式链。"""
    # 1) run 级别直接设置
    rpr = run._element.find(f"{W}rPr")
    if rpr is not None:
        fonts = rpr.find(f"{W}rFonts")
        if fonts is not None:
            ea = fonts.get(f"{W}eastAsia")
            if ea:
                return ea

    # 2) 样式链
    for style in style_stack:
        try:
            rpr = style.element.find(f"{W}rPr")
            if rpr is None:
                continue
            fonts = rpr.find(f"{W}rFonts")
            if fonts is not None:
                ea = fonts.get(f"{W}eastAsia")
                if ea:
                    return ea
        except Exception:
            continue

    # 3) 文档默认
    return None


def _resolve_latin_font(run, style_stack) -> Optional[str]:
    """获取西文字体。"""
    rpr = run._element.find(f"{W}rPr")
    if rpr is not None:
        fonts = rpr.find(f"{W}rFonts")
        if fonts is not None:
            lat = fonts.get(f"{W}ascii")
            if lat:
                return lat

    if run.font.name:
        return run.font.name

    for style in style_stack:
        try:
            if style.font and style.font.name:
                return style.font.name
            rpr = style.element.find(f"{W}rPr")
            if rpr is not None:
                fonts = rpr.find(f"{W}rFonts")
                if fonts is not None:
                    lat = fonts.get(f"{W}ascii")
                    if lat:
                        return lat
        except Exception:
            continue
    return None


def _resolve_size(run, style_stack) -> Optional[float]:
    """字号：run > 字符样式 > 段落样式链 > 文档默认。"""
    size = _pt(run.font.size)
    if size is not None:
        return size

    for style in style_stack:
        try:
            s = _pt(style.font.size)
            if s is not None:
                return s
        except Exception:
            continue

    # 文档默认（w:docDefaults）
    try:
        styles_el = run.part.document.element.find(f"{W}styles")
        if styles_el is None:
            styles_el = run.part.element.find(f"{W}styles")
        if styles_el is not None:
            defaults = styles_el.find(f"{W}docDefaults")
            if defaults is not None:
                rpr_default = defaults.find(f"{W}rPrDefault/{W}rPr")
                if rpr_default is not None:
                    sz = rpr_default.find(f"{W}sz")
                    if sz is not None and sz.get(f"{W}val"):
                        return round(int(sz.get(f"{W}val")) / 2.0, 2)
    except Exception:
        pass

    return None


def _resolve_bold(run, style_stack) -> Optional[bool]:
    if run.font.bold is not None:
        return run.font.bold
    for style in style_stack:
        try:
            if style.font.bold is not None:
                return style.font.bold
        except Exception:
            continue
    return None


def _resolve_italic(run, style_stack) -> Optional[bool]:
    if run.font.italic is not None:
        return run.font.italic
    for style in style_stack:
        try:
            if style.font.italic is not None:
                return style.font.italic
        except Exception:
            continue
    return None


def _style_chain(paragraph) -> list:
    """段落样式 + 其基样式链。"""
    chain = []
    try:
        style = paragraph.style
        seen = set()
        while style is not None and id(style) not in seen:
            seen.add(id(style))
            chain.append(style)
            style = style.base_style
    except Exception:
        pass
    return chain


def _outline_level(paragraph) -> Optional[int]:
    """大纲级别：0 表示一级标题。"""
    # 1) 段落直接设置
    ppr = paragraph._element.find(f"{W}pPr")
    if ppr is not None:
        lvl = ppr.find(f"{W}outlineLvl")
        if lvl is not None and lvl.get(f"{W}val") is not None:
            return int(lvl.get(f"{W}val"))

    # 2) 样式链
    for style in _style_chain(paragraph):
        try:
            el = style.element.find(f"{W}pPr")
            if el is not None:
                lvl = el.find(f"{W}outlineLvl")
                if lvl is not None and lvl.get(f"{W}val") is not None:
                    return int(lvl.get(f"{W}val"))
        except Exception:
            continue

    # 3) 从样式名推断（Heading 1 / 标题 1）
    name = (paragraph.style.name if paragraph.style else "") or ""
    for i in range(1, 10):
        if name in (f"Heading {i}", f"标题 {i}", f"heading {i}"):
            return i - 1

    return None


_ALIGN_MAP = {
    WD_ALIGN_PARAGRAPH.LEFT: "left",
    WD_ALIGN_PARAGRAPH.CENTER: "center",
    WD_ALIGN_PARAGRAPH.RIGHT: "right",
    WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
    None: None,
}


def _resolve_alignment(paragraph) -> Optional[str]:
    if paragraph.alignment is not None:
        return _ALIGN_MAP.get(paragraph.alignment)
    for style in _style_chain(paragraph):
        try:
            if style.paragraph_format.alignment is not None:
                return _ALIGN_MAP.get(style.paragraph_format.alignment)
        except Exception:
            continue
    return None


def _resolve_line_spacing(paragraph) -> Optional[float]:
    def conv(pf):
        ls = pf.line_spacing
        if ls is None:
            return None
        if isinstance(ls, float):
            return round(ls, 2)
        try:
            # Length 对象：按单倍行距 12pt 估算倍数
            return round(float(ls.pt) / 12.0, 2)
        except Exception:
            return None

    v = conv(paragraph.paragraph_format)
    if v is not None:
        return v
    for style in _style_chain(paragraph):
        try:
            v = conv(style.paragraph_format)
            if v is not None:
                return v
        except Exception:
            continue
    return None


def _resolve_space(paragraph, which: str) -> Optional[float]:
    attr = "space_before" if which == "before" else "space_after"
    v = _pt(getattr(paragraph.paragraph_format, attr))
    if v is not None:
        return v
    for style in _style_chain(paragraph):
        try:
            v = _pt(getattr(style.paragraph_format, attr))
            if v is not None:
                return v
        except Exception:
            continue
    return None


def _first_line_indent_chars(paragraph) -> Optional[float]:
    """首行缩进（以「字符」为单位，1 字符约等于当前字号）。"""
    def conv(pf, size_pt):
        fli = pf.first_line_indent
        if fli is None:
            return None
        try:
            pt = float(fli.pt)
        except Exception:
            return None
        if (size_pt or 0) <= 0:
            return None
        return round(pt / size_pt, 2)

    size = _resolve_size_for_paragraph(paragraph)
    v = conv(paragraph.paragraph_format, size)
    if v is not None:
        return v
    for style in _style_chain(paragraph):
        try:
            v = conv(style.paragraph_format, size)
            if v is not None:
                return v
        except Exception:
            continue
    return None


def _resolve_size_for_paragraph(paragraph) -> Optional[float]:
    if paragraph.runs:
        return _resolve_size(paragraph.runs[0], _style_chain(paragraph))
    for style in _style_chain(paragraph):
        try:
            s = _pt(style.font.size)
            if s is not None:
                return s
        except Exception:
            continue
    return 12.0


def extract_format(docx_path: str, max_text: int = 60) -> list[ParaFormat]:
    """提取文档中全部段落的实际格式。"""
    document = Document(docx_path)
    result: list[ParaFormat] = []

    for i, paragraph in enumerate(document.paragraphs, start=1):
        text = (paragraph.text or "").strip()
        chain = _style_chain(paragraph)
        runs = paragraph.runs

        if runs:
            first = runs[0]
            font_name = _resolve_eastasia_font(first, chain)
            font_latin = _resolve_latin_font(first, chain)
            size = _resolve_size(first, chain)
            bold = _resolve_bold(first, chain)
            italic = _resolve_italic(first, chain)
        else:
            font_name = _resolve_eastasia_font(_FakeRun(paragraph), chain)
            font_latin = None
            size = _resolve_size_for_paragraph(paragraph)
            bold = None
            italic = None

        outline = _outline_level(paragraph)

        result.append(
            ParaFormat(
                index=i,
                text=text[:max_text],
                style=paragraph.style.name if paragraph.style else None,
                outline_level=outline,
                is_heading=outline is not None and outline < 9 and bool(text),
                font_name=font_name,
                font_name_latin=font_latin,
                font_size=size,
                bold=bold,
                italic=italic,
                alignment=_resolve_alignment(paragraph),
                line_spacing=_resolve_line_spacing(paragraph),
                space_before=_resolve_space(paragraph, "before"),
                space_after=_resolve_space(paragraph, "after"),
                first_line_indent=_first_line_indent_chars(paragraph),
            )
        )

    return result


class _FakeRun:
    """空段落没有 run，构造一个只承载 XML 的替身。"""

    def __init__(self, paragraph):
        self._element = paragraph._element
        self.part = paragraph.part
        self.font = type("F", (), {"size": None, "name": None, "bold": None, "italic": None})()


def summarize(paras: list[ParaFormat]) -> dict:
    """归纳出各级标题与正文的代表格式。"""
    headings: dict[int, list[ParaFormat]] = {}
    body: list[ParaFormat] = []

    for p in paras:
        if not p.text:
            continue
        if p.is_heading:
            headings.setdefault(p.outline_level, []).append(p)
        else:
            body.append(p)

    def most_common_format(items: list[ParaFormat]) -> dict:
        if not items:
            return {}

        def key(p):
            return (p.font_name, p.font_size, p.bold, p.alignment)

        counts: dict = {}
        for p in items:
            counts.setdefault(key(p), []).append(p)
        best = max(counts.values(), key=len)[0]
        return {
            "font_name": best.font_name,
            "font_name_latin": best.font_name_latin,
            "font_size": best.font_size,
            "bold": best.bold,
            "alignment": best.alignment,
            "line_spacing": best.line_spacing,
            "space_before": best.space_before,
            "space_after": best.space_after,
            "first_line_indent": best.first_line_indent,
            "sample_text": best.text,
            "count": len(items),
        }

    summary = {"headings": {}, "body": most_common_format(body)}
    for level in sorted(headings):
        summary["headings"][level] = most_common_format(headings[level])
    return summary


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("用法: python format_profile.py <文档.docx>")
        sys.exit(1)

    paras = extract_format(sys.argv[1])
    print(json.dumps(summarize(paras), ensure_ascii=False, indent=2))