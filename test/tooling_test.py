import importlib.util
import io
import json
import runpy
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PROJECT = Path(__file__).resolve().parent.parent
PREVIEW = PROJECT / 'tools/capture-preview.py'
CHECKER = PROJECT / 'tools/check-native.py'


def preview_module():
    spec = importlib.util.spec_from_file_location('remaining_preview', PREVIEW)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PreviewTests(unittest.TestCase):
    def load_preview(self):
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='{"overlays": ["unrelated"]}', stderr='')):
            return preview_module()

    def test_import_does_not_access_herdr(self):
        with patch('subprocess.run', side_effect=AssertionError('Import started Herdr')):
            module = preview_module()
        self.assertTrue(callable(module.prepare_preview))

    def test_unsupported_platform_fails_before_app_access(self):
        module = self.load_preview()
        with patch.object(module.sys, 'platform', 'linux'), patch.object(module, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'macOS'):
                module.main()
        run.assert_not_called()

    def test_unrelated_popup_prevents_preview_changes(self):
        module = self.load_preview()
        with patch.object(module.sys, 'platform', 'darwin'), \
                patch.object(module, 'state', return_value={'overlays': ['another-mod']}), \
                patch.object(module, 'prepare_preview') as prepare:
            with self.assertRaisesRegex(RuntimeError, 'Another popup'):
                module.main()
        prepare.assert_not_called()

    def test_preview_is_self_contained_before_widget_installation(self):
        module = self.load_preview()
        with tempfile.TemporaryDirectory() as directory:
            app_home = Path(directory)
            dest = module.prepare_preview(PROJECT, app_home)
            self.assertFalse((app_home / 'mods/remaining').exists())
            view = (dest / 'remaining-view.js').read_text()
            self.assertIn("const MOD = 'remaining-gallery-preview';", view)
            for folder in ['icons', 'rings']:
                source = PROJECT / 'mods/remaining' / folder
                for file in source.iterdir():
                    self.assertEqual((dest / folder / file.name).read_bytes(), file.read_bytes())
            self.assertEqual(json.loads((dest / 'mod.json').read_text())['place'], 'none')

    def test_foreign_preview_folder_is_unchanged(self):
        module = self.load_preview()
        with tempfile.TemporaryDirectory() as directory:
            app_home = Path(directory)
            dest = app_home / 'mods' / module.NAME
            dest.mkdir(parents=True)
            (dest / 'main.js').write_text('user code')
            with self.assertRaises(RuntimeError):
                module.prepare_preview(PROJECT, app_home)
            self.assertEqual([file.name for file in dest.iterdir()], ['main.js'])
            self.assertEqual((dest / 'main.js').read_text(), 'user code')

    def test_preview_folder_cannot_redirect_writes(self):
        module = self.load_preview()
        with tempfile.TemporaryDirectory() as directory:
            app_home = Path(directory)
            foreign = app_home / 'foreign'
            foreign.mkdir()
            (foreign / '.remaining-preview-owned').write_text('marker')
            mods = app_home / 'mods'
            mods.mkdir()
            (mods / module.NAME).symlink_to(foreign, target_is_directory=True)
            with self.assertRaises(RuntimeError):
                module.prepare_preview(PROJECT, app_home)
            self.assertEqual([file.name for file in foreign.iterdir()], ['.remaining-preview-owned'])

    def test_owned_preview_refresh_preserves_unrelated_files(self):
        module = self.load_preview()
        with tempfile.TemporaryDirectory() as directory:
            app_home = Path(directory)
            dest = module.prepare_preview(PROJECT, app_home)
            (dest / 'notes.txt').write_text('keep')
            (dest / '.geometry.json').write_text('{}')
            module.prepare_preview(PROJECT, app_home)
            self.assertEqual((dest / 'notes.txt').read_text(), 'keep')
            self.assertFalse((dest / '.geometry.json').exists())


class NativeSelectionTests(unittest.TestCase):
    def test_invalid_selection_fails_before_fixture_or_native_work(self):
        with patch.object(sys, 'argv', [str(CHECKER), '--case', 'bars', '--case', 'not-a-case']), \
                patch('shutil.copytree') as copy, patch('subprocess.run') as native, \
                redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                runpy.run_path(str(CHECKER), run_name='__main__')
        self.assertEqual(error.exception.code, 2)
        copy.assert_not_called()
        native.assert_not_called()

    def test_valid_selection_checks_only_requested_fixtures(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / 'tools').mkdir()
            checker = project / 'tools/check-native.py'
            shutil.copy2(CHECKER, checker)
            shutil.copytree(PROJECT / 'mods/remaining', project / 'mods/remaining')
            with patch.object(sys, 'argv', [str(checker), '--case', 'bars', '--case', 'rings']), \
                    patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='', stderr='')) as native, \
                    redirect_stdout(io.StringIO()):
                runpy.run_path(str(checker), run_name='__main__')
            paths = [Path(call.args[0][-1]) for call in native.call_args_list]
            self.assertEqual([path.name for path in paths], ['bars', 'rings'])
            self.assertEqual(sorted(file.name for file in (project / '.local/native').iterdir()), ['bars', 'rings'])
            self.assertIn("theme: 'bars'", (paths[0] / 'main.js').read_text())
            self.assertIn("theme: 'rings'", (paths[1] / 'main.js').read_text())


if __name__ == '__main__':
    unittest.main()
