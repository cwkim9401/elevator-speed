"""PWA 아이콘(icon-192.png, icon-512.png) 생성기.

엘리베이터 상/하강 표시등 모양(위/아래 삼각형)을 그린다.
실행:  python make_icons.py   (이 폴더에서)
"""
from PIL import Image, ImageDraw

BG = (17, 21, 28, 255)        # #11151c
ACCENT = (54, 211, 153, 255)  # #36d399


def make(size):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    cx = size / 2.0
    w = size * 0.20  # 삼각형 반너비 (마스커블 안전 영역 안)
    # 위쪽(상승) 삼각형
    d.polygon([(cx, size * 0.27), (cx - w, size * 0.47), (cx + w, size * 0.47)], fill=ACCENT)
    # 아래쪽(하강) 삼각형
    d.polygon([(cx, size * 0.73), (cx - w, size * 0.53), (cx + w, size * 0.53)], fill=ACCENT)
    return img


if __name__ == "__main__":
    for s in (192, 512):
        make(s).save("icon-{}.png".format(s))
    print("icons written: icon-192.png, icon-512.png")
