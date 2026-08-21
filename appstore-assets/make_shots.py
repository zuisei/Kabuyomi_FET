#!/usr/bin/env python3
"""App Store スクリーンショットの組版(6.9インチ / 1320x2868)

素材: raw/*.png(iPhone 17 Pro Max・iOS 26.4 の実機シミュレータ撮影、1320x2868)
出力: out/*.png(同サイズ。Apple の 6.9" 枠にそのまま入る)

設計方針:
- 文言は ASO 案(名称・サブタイトル)と語彙を揃える。検索で見た言葉がページでも出る状態にする。
- 1枚目で「何のアプリか」を確定させる。2枚目以降で信頼(根拠・原文)を積む。
- 誇張しない。実装済みの機能だけを書く。投資助言でない旨は本文側で担保済み。
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")   # 撮影素材(1320x2868の実機スクショ)
OUT = HERE                        # 生成物はこのフォルダ直下
os.makedirs(OUT, exist_ok=True)

W, H = 1320, 2868
BG = (247, 245, 241)        # アプリ本体と同系の温かいオフホワイト
INK = (26, 32, 44)          # 見出し
SUB = (108, 114, 126)       # 副文
ACCENT = (23, 58, 95)       # アプリのネイビー

F_BOLD = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"
F_MED = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
F_REG = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
if not os.path.exists(F_REG):
    F_REG = F_MED

# (素材, 見出し2行, 副文, 端末画像の下端から落とすpx)
# crop_bottom: シミュレータ特有の状態(App Attest不可によるクレジット0の警告)は
#   実際の新規ユーザー(ウェルカム50クレジット)と異なるため写さない。
SHOTS = [
    ("01_research.png",
     ["米国株の決算を、", "日本語で読む。"],
     "SEC提出の 10-K / 10-Q を、そのまま確認できます", 0),
    ("02_company.png",
     ["売上・利益・CFを、", "要点から。"],
     "主要な数値と前年同期比を、提出資料ベースで表示", 430),
    ("03_sources.png",
     ["すべての記述に、", "出典があります。"],
     "答えの元になった箇所を一覧で確認できます", 0),
    ("04_source_detail.png",
     ["英語の原文も、", "すぐ隣に。"],
     "SEC の原文リンクつき。気になる一節は日本語に翻訳", 0),
]


def rounded(im, r):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                           radius=r, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


def compose(src, heads, sub, dst, crop_bottom=0):
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)

    f_head = ImageFont.truetype(F_BOLD, 92)
    f_sub = ImageFont.truetype(F_REG, 44)

    # 見出し(左寄せ・2行)
    x = 96
    y = 150
    for line in heads:
        d.text((x, y), line, font=f_head, fill=INK)
        y += 112
    y += 26
    d.text((x, y), sub, font=f_sub, fill=SUB)
    y += 96

    # アクセントの短い罫(視線を下へ送る)
    d.rounded_rectangle([x, y, x + 108, y + 8], radius=4, fill=ACCENT)
    y += 78

    # 端末画面(角丸+影)。上部の見出し領域を残して縮小配置
    shot = Image.open(os.path.join(RAW, src)).convert("RGB")
    if crop_bottom:
        shot = shot.crop((0, 0, shot.width, shot.height - crop_bottom))
    avail_h = H - y - 70
    scale = min((W - 2 * 150) / shot.width, avail_h / shot.height)
    nw, nh = int(shot.width * scale), int(shot.height * scale)
    shot = shot.resize((nw, nh), Image.LANCZOS)
    shot = rounded(shot, 56)

    px = (W - nw) // 2

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([px + 10, y + 16, px + nw + 10, y + nh + 16],
                         radius=56, fill=(20, 26, 38, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)

    canvas.paste(shot, (px, y), shot)
    canvas.convert("RGB").save(os.path.join(OUT, dst), "PNG", optimize=True)
    return dst, (W, H)


if __name__ == "__main__":
    for i, (src, heads, sub, crop) in enumerate(SHOTS, 1):
        name, size = compose(src, heads, sub, f"appstore_{i:02d}.png", crop)
        print(f"{name}  {size[0]}x{size[1]}  ← {src}")
    print(f"\n出力先: {OUT}")
