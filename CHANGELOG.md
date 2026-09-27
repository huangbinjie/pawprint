# Changelog

Release notes for published Pawprint builds. Builds are available for Apple silicon Macs and Windows x64.

## 0.11.9

- Add an opt-in text pet assistant with Ollama, LM Studio, MiMo, DeepSeek, OpenAI and compatible APIs.
- Keep each pet's personality separate; allow explicit website/app actions and end conversations by cancelling requests and clearing context.
- Provide official external model download links and setup guidance, with no bundled inference runtime or microphone listening.
- Enable idle walking and occasional ball play by default while preserving explicit opt-outs.
- Remove clipped focus bars around the floating pet, tighten speech bubbles and restyle update buttons.

## 0.11.8

- Add a Windows x64 NSIS installer, native window controls and a color tray icon.
- Show Windows quota in the tray menu and tooltip; double-click the tray icon to open home.
- Select platform-specific updates; Windows opens the release page for manual installation.
- Build and smoke-test the packaged Windows app in CI before publishing the release.

## 0.11.7

- Stop repeatedly hiding an already hidden activity bubble during idle patrol.
- Pause floating-window rendering while macOS is locked or asleep, and restore it on unlock or wake.

## 0.11.6

- Package the unsigned beta with a complete ad-hoc bundle signature so downloaded Macs show the manual “Open Anyway” Gatekeeper path instead of “damaged.”
- Check the complete bundle signature before a public release.

## 0.11.6

- Ship a complete ad-hoc signed Mac beta so first launch can use macOS’s per-app Open Anyway flow instead of the damaged-app alert.

## 0.11.5

- Allow enough time for verified Mac release downloads on slower connections.

## 0.11.4

- Move Codex activity bubbles above the pet into a click-through window, preserving the pet hit target.
- Restore the optional screen-edge patrol and remove the shrink during turns and tail-chase rotation.

## 0.11.3

- Move the repository, release source, and website to the `huangbinjie` GitHub account.

## 0.11.2

- Add GitHub Actions packaging, a Pages website, and in-app update checks with download verification and installation.

## 0.11.1

- Keep the original portrait while refining blinks, ear motion, and tail motion.
- Add earless and tailless genes with catalog odds and a tailless skill fallback.

## 0.11.0

- Stabilize the floating pet, menu bar quota, local usage reader, Chinese and English app UI, LAN visits and breeding, and the gene and skill catalogs.
