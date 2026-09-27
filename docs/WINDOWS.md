# Windows support

The Windows target is Windows 10/11 x64. ARM64-native Windows and Intel Mac packages are not provided by this change. Windows support must still pass the new Windows CI job and the manual checks below before it is described as runtime-verified.

## Build and install

Use Node.js 22.12+ and run `npm ci`, `npm test`, then `npm run package:win` on Windows. The output is `release/Pawprint-<version>-win-x64-setup.exe`, a per-user NSIS installer with an optional destination directory. Windows CI uploads the installer and a SHA-256 file as artifacts. On version tags, the release workflow attaches them to the same release as the Mac archive after the Mac job creates that release.

The installer currently has no Windows code-signing certificate configured. Check the published checksum with PowerShell `Get-FileHash <installer.exe> -Algorithm SHA256`. Follow your organization's policy for unsigned applications.

## Platform behavior

- The main window uses native Windows minimize, maximize and close buttons. Pets and activity bubbles remain transparent floating windows.
- The taskbar tray uses a color icon; double-click opens the home window. Quota appears in its menu and tooltip because Windows does not support macOS-style text beside the tray icon.
- Saves are under `%APPDATA%\Pawprint`. Updating and uninstalling preserve app data.
- Codex records default to `%USERPROFILE%\.codex`; `CODEX_HOME` or the in-app folder chooser can select another directory. If Codex runs in WSL, choose the actual accessible WSL records folder. Pawprint does not automatically discover WSL distributions.
- The Mac-only shortcut that launches the Codex desktop client is disabled on Windows. Start your AI client normally; local record reading does not depend on that shortcut.
- Checking updates selects only the Windows x64 installer with its checksum. The download button opens the official release page; verify the installer, quit Pawprint and run it manually. There is no automatic Windows installer execution.
- Nearby homes still use local network discovery. Windows Firewall may require allowing Pawprint on the intended private network. Cross-platform discovery and visits need verification.

## Acceptance

CI runs the core tests, creates the NSIS package, launches the unpacked packaged executable, opens settings, checks tray creation and verifies preference persistence across restart. The Unix installer test remains Mac/Unix-only.

On Windows, additionally verify installing via NSIS, first launch, title-bar controls, close/reopen through the tray, dragging and clicking the pet, pointer pass-through, taskbar avoidance, multiple monitors with mixed DPI, sleep/wake, notifications, local Codex usage/activity, LAN pairing with a Mac, update installation and uninstall/reinstall with the same save. CI startup checks do not establish these interactive outcomes.
