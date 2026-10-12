# 持合い

直近の有価証券報告書（会計期末 2024-01-01 以降）から読んだ大株主を、Obsidian のグラフのように見る静的サイトです。全体は出資で引き合う配置、点を開くと深さ 1 か 2 の周辺です。相互持合いは左の一覧と、グラフの金色の線です。

データは EDINET の有報を株式情報基盤の有報テキストから復元したものです。投資助言ではありません。

事業等のリスクの差分は [risk/](risk/) です。公開先は https://satoki252595.github.io/kabulab-shareholder-graph/risk/ です。

再生成は、抽出済みの `/tmp/sh_analysis/out/analysis.json` がある状態で次を実行します。

```bash
python3 scripts/export_graph.py
```
