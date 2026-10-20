# verify

「設定したフォントが実際に使われているか」を目視ではなく画素で確かめるための道具。

## 1. 並べて見る

[`specimen.html`](specimen.html) をブラウザで開く。組み込みスタックと日本語優先スタックが上下に並ぶ。`.after-*` の `font-family` を書き換えれば、自分の設定をそのまま試せる。

## 2. フォントを同定する

[`references.html`](references.html) は 64px の帯を 9 本並べたページ。最初の 5 本が単体フォントの参照（Microsoft YaHei / Yu Gothic UI / Meiryo / MS Gothic / BIZ UDGothic）、残り 4 本が検証対象のスタック。

```console
$ msedge --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=3 --screenshot=ref.png \
    --window-size=820,580 references.html
$ python identify-fonts.py ref.png
ref.png: 2460x1740, 9 bands

before-text  -> Microsoft YaHei   0.0%   (next: BIZ UDGothic 34.1%)
after-text   -> Yu Gothic UI      0.0%   (next: MS Gothic 29.9%)
before-code  -> Microsoft YaHei   0.0%   (next: BIZ UDGothic 34.1%)
after-code   -> MS Gothic         0.0%   (next: Yu Gothic UI 29.9%)
```

Pillow が要る（`pip install pillow`）。結果は `ref.sheet.png` にも書き出される。

## 仕組み

1. 端末の 3 倍の解像度で撮る（16px の文字を 48px で比較するため）。
2. 帯ごとに切り出し、インクの外接矩形で切り詰める。
3. 参照 5 本それぞれと、±6px の平行移動を許してインクの差分率を出す。
4. 最小値がほぼ 0% なら同一フォント。別フォントなら 30% 前後まで開く。

平行移動を許すのは、帯ごとにベースラインが揃っていないため。位置合わせをしないと別フォントでなくても 80% 超の差が出る（最初これで誤判定した）。

## 注意

- 参照フォントが入っていない環境では、参照行自体が別のフォントで描かれ、判定が意味を失う。`ref-*` の行が想定どおりの字形か先に確認する。
- `after-*` を変えたら、`identify-fonts.py` の `NAMES` / `REFS` と帯の並びも合わせる。
- 帯の高さ（64px）を変えるとスライス位置がずれる。
