"""src/app.html + src/data.js + 폰트(쓰는 글자만 잘라서) -> index.html 한 파일.

사용: python tools/build.py
"""
import base64, io, os, re
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'src/app.html'), encoding='utf-8').read()
data = open(os.path.join(ROOT, 'src/data.js'), encoding='utf-8').read()
html = src.replace('/*@DATA@*/', data)

# 화면에 나올 수 있는 글자: 소스 전체 + 영숫자/기호
chars = set(html) | set(chr(c) for c in range(0x20, 0x7f)) | set('·…→←↑↓×♪')
text = ''.join(sorted(c for c in chars if c.isprintable()))

# 사람 이름처럼 입력받는 글자용: 완성형(KS X 1001) 한글 2350자
def _ks(c):
    try:
        c.encode('euc-kr', errors='strict'); return True
    except UnicodeEncodeError:
        return False
KS = ''.join(chr(c) for c in range(0xAC00, 0xD7A4) if _ks(chr(c)))

FONTS = [
    ('Display', 'raw/BlackHanSans.ttf', 400, True),
    ('Pretendard', 'raw/Pretendard-Regular.otf', 400, False),
    ('Pretendard', 'raw/Pretendard-Bold.otf', 700, False),
    ('Pretendard', 'raw/Pretendard-ExtraBold.otf', 800, False),
]
faces = []
for fam, path, weight, names in FONTS:
    font = TTFont(os.path.join(ROOT, path))
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = []
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(text=text + (KS if names else ''))
    sub.subset(font)
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    b64 = base64.b64encode(buf.getvalue()).decode()
    print(f'{fam} {weight}: {len(buf.getvalue())//1024} KB')
    faces.append(f"@font-face{{font-family:'{fam}';font-weight:{weight};font-display:block;src:url(data:font/woff2;base64,{b64}) format('woff2')}}")

html = html.replace('/*@FONTS@*/', '\n'.join(faces))

# 그림 아이콘: assets/icons/*.png -> webp data URI
import glob, json
from PIL import Image
icons = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'assets/icons/*.png'))):
    buf = io.BytesIO()
    Image.open(f).save(buf, 'WEBP', quality=86, method=6)
    icons[os.path.splitext(os.path.basename(f))[0]] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
print('icons', len(icons), sum(len(v) for v in icons.values()) // 1024, 'KB')
html = html.replace('/*@ICONS@*/{}', json.dumps(icons))
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(html)
print('index.html', len(html.encode()) // 1024, 'KB')
