"""제미나이 아이콘 시트(마젠타 바탕 4x4) -> assets/icons/<이름>.png

사용: python tools/cut_icons.py raw/art/icons1.png food,dessert,...(16개, 왼→오, 위→아래)
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZE = 160

def key_out(rgb):
    """마젠타(255,0,255)를 빼고, 가장자리 반투명 픽셀은 마젠타 섞인 만큼 걷어낸다."""
    r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    m = np.clip(np.minimum(r, b) - g, 0, 255) / 255.0       # 마젠타스러움
    a = np.clip(1.0 - (m - 0.25) / 0.6, 0, 1)                # 0.25 이하=불투명, 0.85 이상=투명
    out = rgb.astype(np.float32)
    mag = np.array([255, 0, 255], np.float32)
    safe = np.maximum(a, 1e-3)[..., None]
    out = (out - (1 - a)[..., None] * mag) / safe
    out = np.clip(out, 0, 255)
    return np.dstack([out, a * 255]).astype(np.uint8)

def main(path, names):
    names = names.split(',')
    im = np.array(Image.open(os.path.join(ROOT, path)).convert('RGB'))
    rgba = key_out(im)
    mask = rgba[..., 3] > 40
    lab, n = ndimage.label(ndimage.binary_closing(mask, iterations=3))
    objs = ndimage.find_objects(lab)
    blobs = []
    for i, sl in enumerate(objs):
        area = (lab[sl] == i + 1).sum()
        if area > 800:
            blobs.append((sl, area, i + 1))
    blobs.sort(key=lambda t: -t[1])
    blobs = blobs[:len(names)]
    if len(blobs) != len(names):
        sys.exit(f'덩어리 {len(blobs)}개 — 이름 {len(names)}개와 안 맞음')
    # 줄 단위 정렬: 중심 y로 줄을 나누고 줄 안에서 x
    h = im.shape[0]
    cy = lambda sl: (sl[0].start + sl[0].stop) / 2
    cx = lambda sl: (sl[1].start + sl[1].stop) / 2
    rows = int(round(len(names) ** .5))
    blobs.sort(key=lambda t: cy(t[0]))
    ordered = []
    per = len(names) // rows
    for r in range(rows):
        ordered += sorted(blobs[r * per:(r + 1) * per], key=lambda t: cx(t[0]))
    outdir = os.path.join(ROOT, 'assets/icons')
    os.makedirs(outdir, exist_ok=True)
    for (sl, _, idx), name in zip(ordered, names):
        part = rgba[sl].copy()
        part[..., 3] = np.where(lab[sl] == idx, part[..., 3], 0)
        img = Image.fromarray(part)
        w, hh = img.size
        side = int(max(w, hh) * 1.06)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(img, ((side - w) // 2, (side - hh) // 2))
        sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
        sq.save(os.path.join(outdir, name + '.png'))
        print(name, w, hh)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
