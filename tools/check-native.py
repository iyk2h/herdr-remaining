import argparse
import json
import shutil
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
ROOT = PROJECT / 'mods/remaining'
TESTS = PROJECT / '.local/native'
APP = str(Path.home() / '.local/bin/herdr-app')

def fixture(count=3):
    rows = []
    for index in range(count):
        rows.append({'id': f'account-{index}', 'provider': 'claude' if index % 3 == 0 else 'codex', 'label': ['Claude', 'Work · Codex', 'Personal · Codex'][index % 3],
                     'badge': ['C', 'W', 'P'][index % 3], 'tint': ['ansi3', 'ansi2', 'ansi4'][index % 3],
                     'email': f'account-{index}@example.com', 'status': 'ok', 'fetchedAt': 1000,
                     'windows': [{'label': '5-hour', 'minutes': 300, 'used': [96, 22, 100][index % 3], 'resetAt': 2000000000000},
                                 {'label': 'Weekly', 'minutes': 10080, 'used': [40, 75, 58][index % 3], 'resetAt': 2000000000000}]})
    return {'checkedAt': 1000, 'accounts': rows, 'profiles': rows}

CASES = [('bars', 268, False, 3, 'bars'), ('rail', 76, False, 3, 'bars'),
                                      ('medium', 230, False, 3, 'bars'), ('rings', 268, False, 3, 'rings'),
                                      ('bars-weekly', 268, False, 3, 'bars'), ('rings-weekly', 268, False, 3, 'rings'),
                                      ('bars-mixed', 268, False, 3, 'bars'), ('rings-mixed', 268, False, 3, 'rings'),
                                      ('reset-edge-bars', 268, False, 3, 'bars'), ('reset-edge-rings', 268, False, 3, 'rings'),
                                      ('refreshing', 268, False, 3, 'bars'), ('failed-refresh', 268, False, 3, 'bars'),
                                      ('account-menu', 252, False, 3, 'bars'), ('account-menu-unknown', 252, False, 3, 'bars'),
                                      ('rings-rail', 76, False, 3, 'rings'), ('settings', 360, True, 3, 'bars'),
                                      ('settings-many', 360, True, 20, 'bars'), ('settings-empty', 360, True, 0, 'bars'),
                                      ('settings-copy-working', 360, True, 3, 'bars'), ('settings-copy-copied', 360, True, 3, 'bars'),
                                      ('settings-copy-failed', 360, True, 3, 'bars'), ('settings-backup-copied', 360, True, 3, 'bars'),
                                      ('settings-restore-restored', 360, True, 3, 'bars'), ('settings-restore-warning', 360, True, 3, 'bars'),
                                      ('settings-restore-failed', 360, True, 3, 'bars')]
parser = argparse.ArgumentParser(description='Check synthetic Remaining native states')
parser.add_argument('--case', action='append', choices=[case[0] for case in CASES], default=[], help='Check only this named case; repeat to select more')
selected = set(parser.parse_args().case)

for name, width, settings, count, appearance in CASES:
    if selected and name not in selected:
        continue
    dest = TESTS / name
    shutil.copytree(ROOT, dest, dirs_exist_ok=True)
    text = (dest / 'main.js').read_text()
    snapshot = fixture(count)
    if name.endswith('-weekly'):
        for account in snapshot['accounts']:
            account['windows'] = [window for window in account['windows'] if window['minutes'] == 10080]
    if name.endswith('-mixed'):
        snapshot['accounts'][0]['windows'] = [window for window in snapshot['accounts'][0]['windows'] if window['minutes'] == 10080]
    if name.startswith('reset-edge-'):
        for window in snapshot['accounts'][0]['windows']:
            window['resetAt'] = None
        for window in snapshot['accounts'][1]['windows']:
            window['resetAt'] = 0
    start, end = text.index('  init('), text.index('  async loadThemes(')
    menu = name.startswith('account-menu')
    if name == 'account-menu-unknown':
        snapshot['accounts'][0].pop('provider', None)
    menu_init = "this.accountMenu = 'account-0'; this.menuFocus = cx.focus_handle(); this.menuFocus.focus();" if menu else ''
    init = f'''  init(_props, cx) {{
      this.settings = {str(settings).lower()}; this.width = {width};
      {menu_init}
      this.data = {json.dumps(snapshot)}; this.busy = {str(name == 'refreshing').lower()}; this.error = {'"Offline"' if name == 'failed-refresh' else 'null'};
      this.copyState = '{name.removeprefix('settings-copy-') if name.startswith('settings-copy-') else 'idle'}';
      this.backupState = '{'copied' if name == 'settings-backup-copied' else 'idle'}';
      this.restoreState = '{name.removeprefix('settings-restore-') if name.startswith('settings-restore-') else 'idle'}';
      setShared(PREFS, {{theme: '{appearance}'}});
      setShared(SNAPSHOT, this.data);
    }}
    '''
    (dest / 'main.js').write_text(text[:start] + init + text[end:])
    result = subprocess.run([APP, 'check', str(dest)], capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f'{name}: {result.stdout}\n{result.stderr}')
    print(f'{name}: native check passed')
