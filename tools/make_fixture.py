"""从 Edge/Chrome 的 Bookmarks JSON 导出离线预览树 preview/tree.js。

运行：python tools/make_fixture.py <Bookmarks 路径>
注意：切勿把含私人或内网链接的 tree.js 直接提交到公开仓库。
"""

import json
import os
import sys


def slim(node):
    out = {"id": str(node.get("id") or ""), "title": node.get("name") or ""}
    if node.get("url"):
        out["url"] = node["url"]
    if node.get("children") is not None:
        out["children"] = [slim(c) for c in node["children"]]
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    with open(src, encoding="utf-8") as fh:
        data = json.load(fh)

    tree = {
        "id": "0",
        "title": "",
        "children": [slim(v) for v in data["roots"].values() if isinstance(v, dict) and v.get("children")],
    }
    out_dir = os.path.join(root, "preview")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "tree.js")
    with open(out_file, "w", encoding="utf-8") as fh:
        fh.write("window.__NAV_TREE__ = ")
        json.dump(tree, fh, ensure_ascii=False, indent=2)
        fh.write(";\n")
    print("wrote", out_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
