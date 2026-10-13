#!/usr/bin/env python3
"""UIの回帰チェック。ヘッダー寸法の統一、ダークのコントラスト、銘柄名の欠落を見る。

実行: python3 scripts/selftest_ui.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" :: {extra}" if extra else ""))
    if not cond:
        fails.append(name)


def luminance(hex_color):
    h = hex_color.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(fg, bg):
    lo, hi = sorted((luminance(fg), luminance(bg)))
    return (hi + 0.05) / (lo + 0.05)


root_css = (ROOT / "assets/app.css").read_text(encoding="utf-8")
risk_css = (ROOT / "risk/app.css").read_text(encoding="utf-8")

# 1. ヘッダー: 両ページで .bar の寸法宣言が一致し、テーマボタンが両方にある
def bar_block(css):
    m = re.search(r"(?m)^\.bar \{([^}]*)\}", css)
    return " ".join(m.group(1).split()) if m else ""

check("header .bar identical", bar_block(root_css) == bar_block(risk_css) and bar_block(root_css) != "",
      f"root={bar_block(root_css)[:60]} risk={bar_block(risk_css)[:60]}")
check("scrollbar-gutter both", "scrollbar-gutter: stable" in root_css and "scrollbar-gutter: stable" in risk_css)
for html in ("index.html", "risk/index.html"):
    text = (ROOT / html).read_text(encoding="utf-8")
    check(f"{html} has theme button", 'id="theme"' in text)
    check(f"{html} has .bar", 'class="bar"' in text)

# 2. ダーク: 本文系トークンが背景に対して 4.5:1 以上、免責が faint でない
for label, css in (("root", root_css), ("risk", risk_css)):
    dark = re.search(r'\[data-theme="dark"\] \{([^}]*)\}', css)
    check(f"{label} has dark tokens", dark is not None)
    if dark:
        toks = dict(re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})", dark.group(1)))
        for tok in ("ink", "muted", "faint"):
            if tok in toks and "bg" in toks:
                check(f"{label} dark --{tok} contrast", contrast(toks[tok], toks["bg"]) >= 4.5,
                      f"{contrast(toks[tok], toks['bg']):.2f}")
check("risk disclaimer not faint", not re.search(r"\.disclaimer \{[^}]*var\(--faint\)", risk_css))

# 3. 銘柄名: graph.json に名前なしが無く、readings.js の欠落は graph で埋められるものが残っていない
graph = json.loads((ROOT / "data/graph.json").read_text(encoding="utf-8"))
gnames = {c["code"]: (c.get("name") or "") for c in graph["companies"]}
nameless = [c for c, n in gnames.items() if not n.strip() or n.strip() == c]
check("graph.json all named", not nameless, f"{len(nameless)} {nameless[:5]}")

raw = (ROOT / "risk/readings.js").read_text(encoding="utf-8")
rows = json.loads(raw[len("window.YUHO_READINGS="):].rstrip().rstrip(";"))
empty = [r["code"] for r in rows if not (r.get("name") or "").strip()]
fillable = [c for c in empty if gnames.get(c, "").strip() and gnames[c].strip() != c]
check("readings.js no graph-fillable empty names", not fillable, f"{len(fillable)} {fillable[:5]}")
check("readings.js empty names are rare", len(empty) <= 20, f"{len(empty)}/{len(rows)} {empty[:5]}")
for code in ("6201", "6173"):
    row = next((r for r in rows if r["code"] == code), None)
    check(f"readings {code} named", bool(row and (row.get("name") or "").strip()),
          row.get("name", "") if row else "row missing")

print("RESULT:", "ALL PASS" if not fails else f"FAILED {fails}")
sys.exit(1 if fails else 0)
