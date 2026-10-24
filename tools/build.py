"""src/app.html + src/data.js + src/rules.js + src/online.js + 폰트(쓰는 글자만) + 아이콘 -> 화면 파일 한 장.

결과물
  index.html          GitHub Pages(오프라인 판·온라인 판 모두 — 온라인은 Cloudflare 서버에 붙는다)
  public/index.html   Cloudflare Worker 정적 자산(같은 파일)
  server/shared.js    온라인 서버용 규칙·데이터 (data.js + rules.js 를 CommonJS 로)

사용: python tools/build.py
"""
import base64, glob, io, json, os, shutil
from fontTools import subset
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()
src, data, rules, online = rd('src/app.html'), rd('src/data.js'), rd('src/rules.js'), rd('src/online.js')
html = src.replace('/*@DATA@*/', data).replace('/*@RULES@*/', rules).replace('/*@ONLINE@*/', online)

# 화면에 나올 수 있는 글자: 소스 전체 + 영숫자/기호
chars = set(html) | set(chr(c) for c in range(0x20, 0x7f)) | set('·…→←↑↓×♪')
text = ''.join(sorted(c for c in chars if c.isprintable()))

# 사람 이름·채팅처럼 입력받는 글자용: 완성형(KS X 1001) 한글 2350자
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
icons = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'assets/icons/*.png'))):
    buf = io.BytesIO()
    Image.open(f).save(buf, 'WEBP', quality=86, method=6)
    icons[os.path.splitext(os.path.basename(f))[0]] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
print('icons', len(icons), sum(len(v) for v in icons.values()) // 1024, 'KB')
html = html.replace('/*@ICONS@*/{}', json.dumps(icons))

open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(html)
os.makedirs(os.path.join(ROOT, 'public'), exist_ok=True)
shutil.copyfile(os.path.join(ROOT, 'index.html'), os.path.join(ROOT, 'public/index.html'))
print('index.html', len(html.encode()) // 1024, 'KB  (+ public/index.html)')

# 온라인 서버용 공용 모듈
os.makedirs(os.path.join(ROOT, 'server'), exist_ok=True)
shared = ("'use strict';\n/* 빌드가 만든 파일 — 직접 고치지 말 것. 원본은 src/data.js · src/rules.js */\n"
          + data + '\n' + rules +
          '\nmodule.exports={LIARC,SPYC,DIFFS,MISSIONS,INTROS,PENALTIES,RANDOM,VOTE,weightedPick,maxLiars,hash,rng,shuffle,pick,spyCands,genRound,letters};\n')
open(os.path.join(ROOT, 'server/shared.js'), 'w', encoding='utf-8').write(shared)
print('server/shared.js', len(shared.encode()) // 1024, 'KB')
