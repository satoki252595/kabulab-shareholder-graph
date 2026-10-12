#!/usr/bin/env python3
"""Compact graph JSON for the static shareholder map."""
import json
import math
import random
from pathlib import Path

ROOT = Path("/tmp/sh_analysis/out")
DEST = Path(__file__).resolve().parents[1] / "data" / "graph.json"


def load_supplements():
    asof = ""
    market = {}
    securities = {}
    market_path = ROOT / "marketcap.json"
    if market_path.exists():
        raw = json.loads(market_path.read_text())
        asof = raw.get("asof") or ""
        market = raw.get("rows") or {}
    sec_path = ROOT / "securities.json"
    if sec_path.exists():
        for row in json.loads(sec_path.read_text()):
            securities[row["code"]] = row
    return asof, market, securities

CUSTODY = (
    "カストディ", "マスタートラスト", "トラスティ", "信託口", "信託銀行",
    "ステートストリート", "STATE STREET", "SSBTC", "BANK OF NEW YORK", "BNY",
    "JP MORGAN", "JPMORGAN", "ジェーピーモルガン", "JPモルガン",
    "NORTHERN TRUST", "ノーザン", "ゴールドマン", "GOLDMAN",
    "モルガンスタンレー", "MORGAN STANLEY", "日本証券金融", "ブラックロック",
    "BLACKROCK", "バンガード", "VANGUARD", "CITIBANK", "シティバンク", "HSBC",
)
EMP = ("持株会", "従業員持株", "ESOP", "役員持株")
INS = ("生命保険", "生命", "海上", "火災保険", "損害保険", "損保")
BROKER = ("証券",)
CORP = ("株式会社", "（株）", "(株)", "㈱", "有限会社", "（有）", "(有)", "合同会社", "投資事業", "有限責任組合", "ホールディングス")


def kind_of(name):
    raw = name or ""
    folded = raw.upper().replace(" ", "")
    if any(k.replace(" ", "").upper() in folded for k in CUSTODY):
        return "inst"
    if any(k in raw for k in EMP):
        return "employee"
    if any(k in raw for k in INS) and "生命科学" not in raw and "生命工" not in raw:
        return "insurer"
    if any(k in raw for k in BROKER) and "証券取引所" not in raw:
        return "broker"
    if "(株" in raw or "（株" in raw or "㈱" in raw or raw.endswith("株"):
        return "corp"
    if any(k in raw for k in CORP):
        return "corp"
    if any("\u3040" <= ch <= "\u30ff" or "\u4e00" <= ch <= "\u9fff" for ch in raw):
        return "person"
    if sum(ch.isascii() and ch.isalpha() for ch in raw) >= 8:
        return "foreign"
    return "person"


def artifact_delta(c):
    prior = c.get("P") or {}
    prev = {h["code"]: h for h in prior.get("listed") or []}
    for h in c["L"]["listed"]:
        p = prev.get(h["code"])
        if p and p.get("shares") and h.get("shares") and p["shares"] == h["shares"] and p["ratio"] - h["ratio"] > 15:
            return True
    return False


def main():
    analysis = json.loads((ROOT / "analysis.json").read_text())
    master = {m["code"]: m for m in json.loads((ROOT / "master.json").read_text())}
    gpu = json.loads((ROOT / "gpu_metrics.json").read_text())
    pr = {row["code"]: row["score"] for row in gpu["holder_pagerank"]}
    pr.update({row["code"]: max(pr.get(row["code"], 0), row["score"]) for row in gpu["issuer_pagerank"]})

    companies = {}
    for c in analysis["companies"]:
        holders = []
        for h in c["L"]["holders"][:10]:
            holders.append({
                "name": h["name"],
                "ratio": h["ratio"],
                "kind": kind_of(h["name"]),
                "code": next((x["code"] for x in c["L"]["listed"] if x["name"] == h["name"]), ""),
            })
        companies[c["code"]] = {
            "code": c["code"],
            "name": c["name"],
            "sector": c["sector"] or (master.get(c["code"]) or {}).get("sector") or "",
            "period": (c["period"] or "")[:10],
            "prior": (c["prior_period"] or "")[:10],
            "stable": c["L"]["stable"],
            "inst": c["L"]["inst"],
            "listed": c["L"]["listed_corp"],
            "person": c["L"]["individual"],
            "employee": c["L"]["employee"],
            "insurer": c["L"]["insurer"],
            "corp": c["L"]["corp"],
            "top10": c["L"]["top10"],
            "listedDelta": None if artifact_delta(c) else c["listed_delta"],
            "instDelta": c["inst_delta"],
            "sell": c["sell_score"],
            "cross": bool(c["in_cross"]),
            "inDeg": c["in_degree"],
            "outDeg": c["out_degree"],
            "pr": round(pr.get(c["code"], 0), 6),
            "holders": holders,
        }

    edges = []
    nodes = set(companies)
    for e in analysis["edges"]:
        edges.append({"h": e["holder"], "i": e["issuer"], "r": e["ratio"]})
        nodes.add(e["holder"])
        nodes.add(e["issuer"])
    for code, meta in master.items():
        if code in companies:
            continue
        companies[code] = {
            "code": code,
            "name": meta.get("name") or code,
            "sector": meta.get("sector") or "",
            "period": "",
            "prior": "",
            "stable": None,
            "inst": None,
            "listed": None,
            "person": None,
            "employee": None,
            "insurer": None,
            "corp": None,
            "top10": None,
            "listedDelta": None,
            "instDelta": None,
            "sell": None,
            "cross": False,
            "inDeg": 0,
            "outDeg": 0,
            "pr": round(pr.get(code, 0), 6),
            "holders": [],
        }
    for code in nodes:
        if code not in companies:
            m = master.get(code) or {}
            companies[code] = {
                "code": code,
                "name": m.get("name") or code,
                "sector": m.get("sector") or "",
                "period": "",
                "prior": "",
                "stable": None,
                "inst": None,
                "listed": None,
                "person": None,
                "employee": None,
                "insurer": None,
                "corp": None,
                "top10": None,
                "listedDelta": None,
                "instDelta": None,
                "sell": None,
                "cross": False,
                "inDeg": 0,
                "outDeg": 0,
                "pr": round(pr.get(code, 0), 6),
                "holders": [],
            }

    # Degree from the exported edges, including companies that only appear as holders.
    indeg = {c: 0 for c in companies}
    outdeg = {c: 0 for c in companies}
    for e in edges:
        outdeg[e["h"]] = outdeg.get(e["h"], 0) + 1
        indeg[e["i"]] = indeg.get(e["i"], 0) + 1
    for code, row in companies.items():
        row["inDeg"] = indeg.get(code, 0)
        row["outDeg"] = outdeg.get(code, 0)

    sectors = sorted({(companies[c]["sector"] or "不明") for c in nodes})
    ang = {s: (i / max(len(sectors), 1)) * math.tau for i, s in enumerate(sectors)}
    rng = random.Random(11)
    pos = {}
    for code in nodes:
        a = ang[companies[code]["sector"] or "不明"]
        radius = 0.42 + rng.random() * 0.5
        pos[code] = [math.cos(a) * radius, math.sin(a) * radius]
    index = {c: i for i, c in enumerate(nodes)}
    order = list(nodes)
    n = len(order)
    # A short pull along ownership edges so related names sit nearer each other.
    for _ in range(40):
        disp = [[0.0, 0.0] for _ in order]
        for e in edges:
            a = index[e["h"]]
            b = index[e["i"]]
            dx = pos[e["i"]][0] - pos[e["h"]][0]
            dy = pos[e["i"]][1] - pos[e["h"]][1]
            disp[a][0] += dx * 0.02
            disp[a][1] += dy * 0.02
            disp[b][0] -= dx * 0.02
            disp[b][1] -= dy * 0.02
        for i, code in enumerate(order):
            pos[code][0] += disp[i][0]
            pos[code][1] += disp[i][1]

    asof_market, market, securities = load_supplements()
    for code, row in companies.items():
        quote = market.get(code) or {}
        row["sharesOut"] = quote.get("shares")
        row["marketCap"] = quote.get("marketCap")
        src = securities.get(code) or {}
        buckets = src.get("buckets") or {}
        names = []
        for item in (src.get("names") or []):
            held = item.get("shares")
            price = None
            approx = None
            target = market.get(item.get("code") or "")
            if held and target and target.get("shares") and target.get("marketCap"):
                price = target["marketCap"] / target["shares"]
                approx = int(held * price)
                price = round(price, 2)
            names.append({
                "name": item.get("name") or "",
                "shares": held,
                "code": item.get("code") or "",
                "price": price,
                "value": approx,
            })
        row["securities"] = None
        if buckets or names:
            row["securities"] = {
                "period": (src.get("period") or "")[:10],
                "unlistedN": buckets.get("unlistedN"),
                "unlistedBook": buckets.get("unlistedBook"),
                "listedN": buckets.get("listedN"),
                "listedBook": buckets.get("listedBook"),
                "names": names,
            }

    payload = {
        "asof": "2026-10-13",
        "marketAsOf": asof_market,
        "source": "EDINET有価証券報告書（株式情報基盤の有報テキスト。銘柄マスタの各社について、取れる直近の大株主表）",
        "device": gpu.get("device") or "",
        "companies": list(companies.values()),
        "edges": edges,
        "mutual": [[m["a"], m["b"]] for m in analysis["mutual"]],
        "pos": {c: [round(pos[c][0], 4), round(pos[c][1], 4)] for c in nodes},
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {DEST} companies={len(payload['companies'])} edges={len(edges)} bytes={DEST.stat().st_size}")


if __name__ == "__main__":
    main()
