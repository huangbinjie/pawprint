#!/usr/bin/env python3
"""Preview/export a Pawprint-only repair; --apply backs up before installation."""
import argparse
import copy
import json
import os
import signal
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import plistlib

TARGET = 'studio.binmax.pawprint'
SOURCE = Path.home() / 'Library/Group Containers/group.com.apple.controlcenter/Library/Preferences/group.com.apple.controlcenter.plist'


def bundle(location):
    value = location.get('bundle') if isinstance(location, dict) else None
    return value.get('_0') if isinstance(value, dict) else None


def repair(data):
    result = copy.deepcopy(data)
    raw = result.get('trackedApplications')
    encoded = isinstance(raw, bytes)
    apps = plistlib.loads(raw) if encoded else raw
    if not isinstance(apps, list) or not all(isinstance(row, dict) for row in apps):
        raise ValueError('Unsupported trackedApplications format; no repair exported.')
    own = [row for row in apps if bundle(row.get('location')) == TARGET]
    if not own or not all(row.get('isAllowed') is True for row in own):
        raise ValueError('Pawprint must have its own enabled menu-bar entry; no repair exported.')
    changes = []
    for row in apps:
        owner = bundle(row.get('location'))
        if owner == TARGET:
            continue
        locations = row.get('menuItemLocations', [])
        if not isinstance(locations, list):
            raise ValueError('Unsupported menuItemLocations format; no repair exported.')
        kept = [loc for loc in locations if bundle(loc) != TARGET]
        if len(kept) != len(locations):
            row['menuItemLocations'] = kept
            changes.append({'owner': owner, 'ownerAllowed': row.get('isAllowed'), 'removedReferences': len(locations) - len(kept)})
    result['trackedApplications'] = plistlib.dumps(apps, fmt=plistlib.FMT_BINARY, sort_keys=False) if encoded else apps
    return result, changes


def write_new(file, data):
    with os.fdopen(os.open(str(file), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def processes():
    rows = subprocess.check_output(['ps', '-axo', 'pid=,uid=,comm='], text=True)
    result = {}
    for line in rows.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3 and int(parts[1]) == os.getuid():
            result[int(parts[0])] = parts[2]
    return result


def protected_processes():
    # Observe only; no repair step signals or launches these applications.
    return {pid: command for pid, command in processes().items()
            if Path(command).name in ('Pawprint', 'ChatGPT', 'Codex', 'codex')}


def refresh_preferences_services():
    allowed = {
        '/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter',
        '/usr/sbin/cfprefsd',
    }
    for pid, command in processes().items():
        if command in allowed:
            try:
                # Do not let stale preferences flush over the imported repair.
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def import_preferences(source, exported):
    subprocess.run(['/usr/bin/defaults', 'import', str(source), str(exported)],
                   check=True, capture_output=True, text=True, timeout=20)


def apply_repair(source, backup_root, refresh=refresh_preferences_services,
                 importer=import_preferences, protected=protected_processes, wait=time.sleep):
    original = source.read_bytes()
    fixed, changes = repair(plistlib.loads(original))
    if not changes:
        return {'target': TARGET, 'changed': False, 'reason': 'No foreign Pawprint associations found.'}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    backup = backup_root / stamp
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    before_file, fixed_file = backup / 'original.plist', backup / 'repaired.plist'
    write_new(before_file, original)
    write_new(fixed_file, plistlib.dumps(fixed, fmt=plistlib.FMT_BINARY, sort_keys=False))
    before_pids = protected()
    report = {'target': TARGET, 'backup': str(backup), 'foreignAssociations': changes,
              'beforeProcesses': before_pids, 'changed': False}
    started = False
    try:
        if source.read_bytes() != original:
            raise ValueError('Preferences changed after backup. Retry; live preferences were not modified.')
        started = True
        refresh()
        importer(source, fixed_file)
        wait(2)
        actual = plistlib.loads(source.read_bytes())
        if repair(actual)[1]:
            raise ValueError('Pawprint associations were restored by the system; rolling back.')
        report.update(changed=True, afterProcesses=protected())
        report['originalProcessesStillRunning'] = all(
            report['afterProcesses'].get(pid) == command for pid, command in before_pids.items())
    except Exception as error:
        report['error'] = str(error)
        if started:
            try:
                refresh()
                importer(source, before_file)
                wait(2)
                if plistlib.loads(source.read_bytes()) != plistlib.loads(original):
                    raise ValueError('Restored preferences did not match the backup.')
                report['rolledBack'] = True
            except Exception as rollback_error:
                report.update(rolledBack=False, rollbackError=str(rollback_error))
        report['afterProcesses'] = protected()
    try:
        write_new(backup / 'result.json', json.dumps(report, ensure_ascii=False, indent=2).encode())
    except OSError as error:
        report['reportWriteError'] = str(error)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--output', type=Path, help='Export repaired and original copies; never install them.')
    parser.add_argument('--apply', action='store_true', help='Back up, install the targeted repair, and refresh only ControlCenter/user cfprefsd.')
    parser.add_argument('--backup-root', type=Path, default=Path.home() / 'Library/Application Support/Pawprint/menubar-repair-backups')
    args = parser.parse_args()
    try:
        if args.apply:
            if args.source != SOURCE or args.output:
                raise ValueError('--apply accepts only the standard macOS source and cannot be combined with --output.')
            result = apply_repair(args.source, args.backup_root)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if result.get('error') else 0
        original = args.source.read_bytes()
        fixed, changes = repair(plistlib.loads(original))
        if args.source.read_bytes() != original:
            raise ValueError('Preferences changed during preview; retry. No repair exported.')
        if args.output and changes:
            backup = args.output.with_name(args.output.name + '.original.plist')
            if args.output.exists() or backup.exists():
                raise ValueError('Output/backup already exists; choose a new path.')
            write_new(backup, original)
            write_new(args.output, plistlib.dumps(fixed, fmt=plistlib.FMT_BINARY, sort_keys=False))
        print(json.dumps({'target': TARGET, 'foreignAssociations': changes, 'livePreferencesChanged': False, 'exported': bool(args.output and changes)}, ensure_ascii=False, indent=2))
    except PermissionError:
        parser.exit(2, 'macOS denied access to its protected preferences. Run this preview in a terminal you have granted Full Disk Access. Nothing was changed.\n')
    except (ValueError, OSError, plistlib.InvalidFileException, subprocess.SubprocessError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
