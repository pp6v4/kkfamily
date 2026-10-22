"""Extract the eight historical design documents to searchable Markdown.

Read-only for DOCX sources. Uses only Python's standard library. The generated
files are a content archive, not a replacement for Word layout or current rules.
Existing output is never overwritten. No credentials or external links are read.
"""
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

DOCUMENTS = (
    "家庭生活协作微信小程序-初版部署方案-v1.3.docx",
    "家庭生活协作微信小程序-技术选型与部署建议-v1.3.docx",
    "家庭生活协作微信小程序-数据库设计说明书-v2.2.docx",
    "家庭生活协作微信小程序-详细设计说明书-v2.2.docx",
    "家庭生活协作微信小程序-需求调研记录-v1.5.docx",
    "家庭生活协作微信小程序-需求规格说明书-v2.2.docx",
    "家庭生活协作微信小程序-需求追踪矩阵-v1.2.docx",
    "家庭生活协作微信小程序-总体设计说明书-v2.2.docx",
)
NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"


def text(element):
    return "".join(node.text or "" for node in element.iter(W + "t"))


def scan_sensitive(value):
    patterns = {
        "private-key": r"-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----",
        "github-token": r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})",
        "tencent-secret-id": r"AKID[A-Za-z0-9]{28,}",
        "wechat-secret-assignment": r"(?i)(?:appsecret|wechat_app_secret)\s*[:=：]\s*[\"']?[a-f0-9]{32}(?![a-f0-9])",
        "signed-url": r"(?i)(?:q-signature|access_token|refresh_token)=[A-Za-z0-9_%+-]{16,}",
    }
    return [label for label, pattern in patterns.items() if re.search(pattern, value)]


def extract(filename):
    with ZipFile(filename) as archive:
        xml = archive.read("word/document.xml")
        body = ET.fromstring(xml).find("w:body", NS)
        if body is None:
            raise ValueError("Missing document body: " + filename.name)
        # Do not silently drop diagrams or supplementary text from an archive.
        images = [name for name in archive.namelist() if name.startswith("word/media/")]
        if images:
            raise ValueError("Embedded media requires a separate archival review: " + filename.name)
        all_xml_text = "\n".join(
            archive.read(name).decode("utf-8", errors="replace")
            for name in archive.namelist() if name.endswith(".xml")
        )
        findings = scan_sensitive(all_xml_text)
        if findings:
            raise ValueError(f"Sensitive-content review required: {filename.name}: {','.join(findings)}")
        paragraphs, rows, blocks = 0, 0, []
        for child in body:
            if child.tag == W + "p":
                value = text(child)
                if value.strip():
                    paragraphs += 1
                    style = child.find("w:pPr/w:pStyle", NS)
                    style_id = style.get(W + "val", "") if style is not None else ""
                    heading = re.search(r"(?i)(?:heading|标题)\s*([1-6])", style_id)
                    prefix = "#" * min(int(heading.group(1)) + 1, 6) + " " if heading else ""
                    blocks.append(prefix + value)
            elif child.tag == W + "tbl":
                table = []
                for row in child.findall("w:tr", NS):
                    cells = []
                    for cell in row.findall("w:tc", NS):
                        parts = [text(p) for p in cell.findall("w:p", NS)]
                        cells.append("<br>".join(parts).replace("|", "\\|"))
                    table.append(cells)
                if table:
                    rows += len(table)
                    width = max(map(len, table))
                    rendered = ["| " + " | ".join(row + [""] * (width - len(row))) + " |" for row in table]
                    rendered.insert(1, "| " + " | ".join(["---"] * width) + " |")
                    blocks.append("\n".join(rendered))
        # Check every main-body text node survives conversion (including cells).
        joined = "\n\n".join(blocks)
        source_text = [node.text for node in body.iter(W + "t") if node.text]
        for value in source_text:
            if value.replace("|", "\\|") not in joined:
                raise ValueError("Text conversion omitted a source run: " + filename.name)
        return joined, {"paragraphs": paragraphs, "table_rows": rows, "text_runs": len(source_text)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    source, destination = args.source.resolve(), args.destination.resolve()
    if not source.is_dir():
        raise SystemExit("Source directory does not exist")
    names = [Path(name).with_suffix(".md").name for name in DOCUMENTS]
    targets = [destination / name for name in names] + [destination / "manifest.json"]
    if any(target.exists() for target in targets):
        raise SystemExit("Refusing to overwrite an existing archive")
    prepared, manifest = [], []
    for name, output_name in zip(DOCUMENTS, names):
        filename = source / name
        body, counts = extract(filename)
        source_hash = hashlib.sha256(filename.read_bytes()).hexdigest()
        content = (
            f"# {filename.stem}\n\n"
            "历史正文归档，原资料时点为2026-08-31。本文完整转存正文与表格，不复现Word版式；"
            "不是当前版本的实现或验收声明。后续需求决定和当前交接记录优先。\n\n"
            f"原文件：`{name}`；SHA256：`{source_hash}`。\n\n---\n\n{body}\n"
        )
        prepared.append((destination / output_name, content))
        manifest.append({"source": name, "source_sha256": source_hash,
                         "markdown": output_name, "markdown_sha256": hashlib.sha256(content.encode()).hexdigest(), **counts})
    destination.mkdir(parents=True, exist_ok=True)
    for target, content in prepared:
        with target.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
    with (destination / "manifest.json").open("x", encoding="utf-8", newline="\n") as handle:
        json.dump({"source_snapshot": "2026-08-31", "format": "body-and-tables-markdown",
                   "layout_revalidated": False, "documents": manifest}, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"documents": len(prepared), "paragraphs": sum(row["paragraphs"] for row in manifest),
                      "table_rows": sum(row["table_rows"] for row in manifest), "destination": str(destination)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
