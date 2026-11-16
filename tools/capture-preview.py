import json
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
APP_HOME = Path(os.environ.get('HERDR_APP_HOME', Path.home() / '.config/herdr-app'))
APP = str(Path.home() / '.local/bin/herdr-app')
NAME = 'remaining-gallery-preview'
LOCAL = PROJECT / '.local'
WIDTH, HEIGHT = 720, 360

def run(*args, timeout=40):
    result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr[:300] or 'Preview operation failed')
    return result.stdout.strip()

def state():
    return json.loads(run(APP, 'status'))

def prepare_preview(project, app_home):
    dest = app_home / 'mods' / NAME
    marker = dest / '.remaining-preview-owned'
    if dest.is_symlink() or marker.is_symlink() or (dest.exists() and not marker.is_file()):
        raise RuntimeError('Preview name belongs to another mod')
    runtime = project / 'mods/remaining'
    view = (runtime / 'main.js').read_text()
    declaration = "const MOD = 'remaining';"
    if view.count(declaration) != 1:
        raise RuntimeError('Cannot isolate the preview mod namespace')
    dest.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker.write_text('Synthetic preview only.\n')
    for item in runtime.glob('*.mjs'):
        shutil.copy2(item, dest / item.name)
    for folder in ['icons', 'rings']:
        shutil.copytree(runtime / folder, dest / folder, dirs_exist_ok=True)
    (dest / 'remaining-view.js').write_text(view.replace(declaration, f"const MOD = '{NAME}';", 1))
    shutil.copy2(project / 'tools/preview/main.js', dest / 'main.js')
    (dest / '.geometry.json').unlink(missing_ok=True)
    (dest / 'mod.json').write_text(json.dumps({'place': 'none', 'title': 'Remaining preview', 'overlay': {'width': WIDTH, 'height': HEIGHT}}))
    return dest


def main():
    if sys.platform != 'darwin':
        raise RuntimeError('The preview capture requires macOS')
    if any(name != 'toast' for name in state().get('overlays', [])):
        raise RuntimeError('Another popup is open; leaving it alone')
    dest = prepare_preview(PROJECT, APP_HOME)
    run(APP, 'check', str(dest), timeout=90)
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    raw = LOCAL / 'preview-full.png'
    try:
        time.sleep(1)
        run('open', '-a', 'Herdr')
        time.sleep(0.3)
        run(APP, 'do', 'mod.open', json.dumps({'name': NAME}))
        for _ in range(40):
            if NAME in state().get('overlays', []) and (dest / '.geometry.json').is_file():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('Preview was dismissed or did not finish rendering')
        time.sleep(0.25)
        run(APP, 'shot', str(raw))
        viewport = json.loads((dest / '.geometry.json').read_text())
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


if __name__ == '__main__':
    main()
