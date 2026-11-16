import json
import os
import shutil
import struct
import subprocess
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
APP_HOME = Path(os.environ.get('HERDR_APP_HOME', Path.home() / '.config/herdr-app'))
APP = str(Path.home() / '.local/bin/herdr-app')
NAME = 'remaining-gallery-preview'
DEST = APP_HOME / 'mods' / NAME
LOCAL = PROJECT / '.local'
WIDTH, HEIGHT = 720, 360

def run(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr[:300] or 'Preview operation failed')
    return result.stdout.strip()

def state():
    return json.loads(run(APP, 'status'))

if any(name != 'toast' for name in state().get('overlays', [])):
    raise RuntimeError('Another popup is open; leaving it alone')
if DEST.exists() and not (DEST / '.remaining-preview-owned').is_file():
    raise RuntimeError('Preview name belongs to another mod')
DEST.mkdir(mode=0o700, parents=True, exist_ok=True)
(DEST / '.remaining-preview-owned').write_text('Synthetic preview only.\n')
for item in (PROJECT / 'mods/remaining').glob('*.mjs'):
    shutil.copy2(item, DEST / item.name)
shutil.copy2(PROJECT / 'mods/remaining/main.js', DEST / 'remaining-view.js')
shutil.copy2(PROJECT / 'tools/preview/main.js', DEST / 'main.js')
(DEST / '.geometry.json').unlink(missing_ok=True)
(DEST / 'mod.json').write_text(json.dumps({'place': 'none', 'title': 'Remaining preview', 'overlay': {'width': WIDTH, 'height': HEIGHT}}))
run(APP, 'check', str(DEST))
LOCAL.mkdir(mode=0o700, exist_ok=True)
raw = LOCAL / 'preview-full.png'
try:
    time.sleep(1)
    run('open', '-a', 'Herdr')
    time.sleep(0.3)
    run(APP, 'do', 'mod.open', json.dumps({'name': NAME}))
    for _ in range(40):
        if NAME in state().get('overlays', []) and (DEST / '.geometry.json').is_file():
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('Preview was dismissed or did not finish rendering')
    time.sleep(0.25)
    run(APP, 'shot', str(raw))
    viewport = json.loads((DEST / '.geometry.json').read_text())
    with raw.open('rb') as file:
        header = file.read(24)
    if header[:8] != b'\x89PNG\r\n\x1a\n':
        raise RuntimeError('Invalid screenshot')
    pixels_w, pixels_h = struct.unpack('>II', header[16:24])
    scale = pixels_w / viewport['width']
    if abs(pixels_h / viewport['height'] - scale) > 0.02 or not 0.5 <= scale <= 4:
        raise RuntimeError('Unexpected screenshot geometry')
    crop_w, crop_h = round((WIDTH - 24) * scale), round((HEIGHT - 24) * scale)
    run('sips', '--cropToHeightWidth', str(crop_h), str(crop_w), str(raw), '--out', str(PROJECT / 'preview.png'))
    print(PROJECT / 'preview.png')
finally:
    run(APP, 'do', 'overlay.close', json.dumps({'id': NAME}))
