"""生成离线预览页（preview/stub-newtab.html 与 preview/stub-options.html）。

运行：python tools/make_preview.py
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PREVIEW = os.path.join(ROOT, "preview")

NO_TRANSITION = "\n<style>* { transition: none !important; animation: none !important; }</style>\n"
STUB_SCRIPTS = '<script src="tree.js"></script>\n<script src="stub.js"></script>\n'


def rewrite(html: str) -> str:
    return (
        html.replace('href="styles/', 'href="../styles/')
        .replace('href="icons/', 'href="../icons/')
        .replace('src="js/', 'src="../js/')
        .replace('href="options.html"', 'href="stub-options.html"')
        .replace('href="newtab.html"', 'href="stub-newtab.html"')
    )


def build(src_name: str) -> str:
    html = rewrite(open(os.path.join(ROOT, src_name), encoding="utf-8").read())
    html = html.replace('<script src="../js/shared.js"></script>', STUB_SCRIPTS + '<script src="../js/shared.js"></script>')
    return html.replace("</head>", NO_TRANSITION + "</head>")


def main() -> int:
    os.makedirs(PREVIEW, exist_ok=True)
    for out_name, src_name in (
        ("stub-newtab.html", "newtab.html"),
        ("stub-options.html", "options.html"),
    ):
        path = os.path.join(PREVIEW, out_name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(build(src_name))
        print("wrote", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
