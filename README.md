# Pawprint

[English](README.md) · [简体中文](README.zh-CN.md) · [Website](https://huangbinjie.github.io/pawprint/) · [Download](https://github.com/huangbinjie/pawprint/releases/latest)

Pawprint is an independent Codex desktop pet for Apple silicon Macs. It turns local Codex activity and GPT-model token usage into a small companion that grows alongside your work. The app runs locally; nearby visits and breeding use your LAN.

![Pawprint's cream tabby companion](site/pet.png)

## What it does

- **Floating pet:** A small cat on your desktop that reacts to local Codex work, blinks, plays, and keeps its inherited look.
- **Codex usage:** Reads local Codex records to show token usage, model-aware estimated cost, and capped pet-coin rewards. Estimates are not your subscription bill.
- **Menu bar quota:** Shows remaining weekly and five-hour Codex quota beside its icon when a recent local snapshot exists. This is not a live account query.
- **Genes and skills:** Hatch an egg, browse trait odds, train skills, and breed new combinations.
- **Nearby homes:** Invite another Pawprint user to visit over your local network; chat text and usage records stay on your Mac.

Pawprint is an independent app and is not affiliated with OpenAI.

## Install

Download the latest Mac archive from [Releases](https://github.com/huangbinjie/pawprint/releases/latest) and verify its SHA-256 file. The beta has a complete ad-hoc bundle signature but is not Apple Developer ID signed or notarized. On first launch, macOS may say it cannot verify the developer: choose Done, then System Settings → Privacy & Security → Open Anyway for Pawprint. If macOS says **damaged**, stop and report that build. See [Mac beta signing](docs/RELEASE_SIGNING.md).

## Develop

Requires Node.js 22.12+ and macOS for the desktop app.

```sh
npm ci
npm run dev
```

Run `npm test` for core checks and `npm run package:local` for an ad-hoc signed local Apple silicon build. The release workflow verifies its complete signature before publishing. Pushing a version tag builds and publishes a Mac archive through GitHub Actions; changes to `site/` deploy the website through GitHub Pages.

Pet data stays in the local app profile. There is no account, cloud sync, cash top-up, or online trading.

See the [changelog](CHANGELOG.md) for release history and [product notes](docs/PRODUCT.md) for detailed behavior.
