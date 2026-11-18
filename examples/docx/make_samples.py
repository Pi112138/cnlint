"""
生成测试用的示例文档：
    sample-标准格式.docx   各级标题/正文格式都正确
    sample-待检测.docx     故意做错若干处
"""

from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn


def set_ea_font(run, name: str):
    """设置中文字体，必须同时写 eastAsia 才生效。"""
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), name)


def add_heading(doc, text, level, font, size, bold=True):
    p = doc.add_paragraph()
    p.style = doc.styles[f"Heading {level}"]
    run = p.add_run(text)
    run.font.size = Pt(size)
    run.font.bold = bold
    set_ea_font(run, font)
    return p


def add_body(doc, text, font="宋体", size=12, indent_chars=2):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size)
    set_ea_font(run, font)
    p.paragraph_format.first_line_indent = Pt(size * indent_chars)
    p.paragraph_format.line_spacing = 1.5
    return p


def build_standard(path):
    doc = Document()
    add_heading(doc, "总体概述", 1, "黑体", 18)
    add_body(doc, "本文档用于演示标准格式，所有段落均符合规范要求。")
    add_heading(doc, "项目背景", 2, "黑体", 16)
    add_body(doc, "随着业务规模扩大，现有系统的性能瓶颈日益明显。")
    add_heading(doc, "技术方案", 2, "黑体", 16)
    add_body(doc, "我们计划引入缓存层，并对核心服务做重构。")
    doc.save(path)
    print(f"已生成：{path}")


def build_target(path):
    doc = Document()

    # 一级标题：正确
    add_heading(doc, "总体概述", 1, "黑体", 18)

    # 正文：正确
    add_body(doc, "本文档用于演示标准格式，所有段落均符合规范要求。")

    # 二级标题：字号错误（应为 16，写成 14）
    add_heading(doc, "项目背景", 2, "黑体", 14)

    # 正文：字号错误（应为 12，写成 10.5）
    add_body(doc, "随着业务规模扩大，现有系统的性能瓶颈日益明显。", size=10.5)

    # 二级标题：字体错误（应为黑体，写成宋体）
    add_heading(doc, "技术方案", 2, "宋体", 16)

    # 正文：缺少首行缩进
    p = doc.add_paragraph()
    run = p.add_run("我们计划引入缓存层，并对核心服务做重构。")
    run.font.size = Pt(12)
    set_ea_font(run, "宋体")
    p.paragraph_format.line_spacing = 1.5

    doc.save(path)
    print(f"已生成：{path}")


if __name__ == "__main__":
    build_standard("sample-格式要求.docx")
    build_target("sample-待检测.docx")