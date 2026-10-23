import copy
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('menubar_repair', Path(__file__).resolve().parents[1] / 'scripts/macos-menubar-association.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def loc(bid):
    return {'bundle': {'_0': bid}}


def row(owner, allowed, items):
    return {'location': loc(owner), 'isAllowed': allowed, 'menuItemLocations': [loc(item) for item in items]}


class MenuBarAssociationRepair(unittest.TestCase):
    def test_service_refresh_never_signals_pawprint_codex_or_root_preferences(self):
        listing = ('11 501 /Applications/Pawprint.app/Contents/MacOS/Pawprint\n'
                   '12 501 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n'
                   '13 0 /usr/sbin/cfprefsd\n'
                   '14 501 /usr/sbin/cfprefsd\n'
                   '15 501 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\n')
        with patch.object(module.subprocess, 'check_output', return_value=listing), patch.object(module.os, 'getuid', return_value=501), patch.object(module.os, 'kill') as kill:
            module.refresh_preferences_services()
            self.assertEqual([call.args[0] for call in kill.call_args_list], [14, 15])

    def test_only_target_references_are_removed_and_other_permissions_layout_stay_identical(self):
        apps = [row('com.openai.codex', False, [module.TARGET, 'com.openai.codex', 'other.app']), row('another.ide', True, [module.TARGET, 'other.app']), row(module.TARGET, True, [module.TARGET])]
        data = {'trackedApplications': plistlib.dumps(apps, fmt=plistlib.FMT_BINARY), 'layout': {'position': 123}, 'otherData': b'keep'}
        original = copy.deepcopy(data)
        fixed, changes = module.repair(data)
        actual = plistlib.loads(fixed['trackedApplications'])
        self.assertEqual(data, original)
        self.assertEqual(actual[0], row('com.openai.codex', False, ['com.openai.codex', 'other.app']))
        self.assertEqual(actual[1], row('another.ide', True, ['other.app']))
        self.assertEqual(actual[2], apps[2])
        self.assertEqual({k: v for k, v in fixed.items() if k != 'trackedApplications'}, {k: v for k, v in data.items() if k != 'trackedApplications'})
        self.assertEqual(len(changes), 2)
        self.assertEqual(module.repair(fixed)[1], [])

    def test_missing_or_disabled_own_entry_is_refused(self):
        for apps in [[], [row(module.TARGET, False, [module.TARGET])]]:
            with self.assertRaises(ValueError):
                module.repair({'trackedApplications': apps})

    def test_similarly_named_apps_are_not_modified(self):
        data = {'trackedApplications': [row('ide', False, [module.TARGET + '.dev']), row(module.TARGET, True, [module.TARGET])]}
        self.assertEqual(module.repair(data), (data, []))

    def test_unknown_schema_is_refused(self):
        for data in [{}, {'trackedApplications': {}}, {'trackedApplications': [42]}]:
            with self.assertRaises(ValueError):
                module.repair(data)

    def test_apply_backs_up_before_refresh_and_keeps_apps_untouched(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'preferences.plist'
            original = plistlib.dumps({'trackedApplications': [row('com.openai.codex', False, [module.TARGET]), row(module.TARGET, True, [module.TARGET])], 'layout': 'preserve'})
            source.write_bytes(original)
            backups = Path(root) / 'backups'
            events = []

            def refresh():
                self.assertEqual(len(list(backups.glob('*/original.plist'))), 1)
                self.assertEqual(next(backups.glob('*/original.plist')).read_bytes(), original)
                events.append('refresh')

            def importer(destination, exported):
                events.append('import')
                destination.write_bytes(exported.read_bytes())

            pids = {123: '/Applications/Pawprint.app/Contents/MacOS/Pawprint', 456: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'}
            report = module.apply_repair(source, backups, refresh=refresh, importer=importer, protected=lambda: pids, wait=lambda _: None)
            self.assertTrue(report['changed'])
            self.assertTrue(report['originalProcessesStillRunning'])
            self.assertEqual(events, ['refresh', 'import'])
            self.assertEqual(module.repair(plistlib.loads(source.read_bytes()))[1], [])
            self.assertEqual(plistlib.loads(source.read_bytes())['layout'], 'preserve')
            self.assertEqual((Path(report['backup']) / 'original.plist').stat().st_mode & 0o777, 0o600)

    def test_failed_import_restores_the_original_backup(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'preferences.plist'
            original = plistlib.dumps({'trackedApplications': [row('com.openai.codex', False, [module.TARGET]), row(module.TARGET, True, [module.TARGET])]})
            source.write_bytes(original)
            calls = []

            def importer(destination, exported):
                calls.append(exported.name)
                if len(calls) == 1:
                    raise RuntimeError('isolated import failure')
                destination.write_bytes(exported.read_bytes())

            report = module.apply_repair(source, Path(root) / 'backups', refresh=lambda: None, importer=importer, protected=lambda: {}, wait=lambda _: None)
            self.assertTrue(report['rolledBack'])
            self.assertFalse(report['changed'])
            self.assertEqual(calls, ['repaired.plist', 'original.plist'])
            self.assertEqual(source.read_bytes(), original)

    def test_concurrent_preference_change_prevents_installation(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'preferences.plist'
            data = {'trackedApplications': [row('com.openai.codex', False, [module.TARGET]), row(module.TARGET, True, [module.TARGET])]}
            source.write_bytes(plistlib.dumps(data))
            updated = plistlib.dumps({**data, 'external-change': True})
            calls = []

            def changed():
                source.write_bytes(updated)
                return {}

            report = module.apply_repair(source, Path(root) / 'backups', protected=changed, refresh=lambda: calls.append('refresh'), importer=lambda *_: calls.append('import'), wait=lambda _: None)
            self.assertIn('changed after backup', report['error'])
            self.assertEqual(calls, [])
            self.assertEqual(source.read_bytes(), updated)


if __name__ == '__main__':
    unittest.main()
