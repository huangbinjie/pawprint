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

Download the latest Mac archive from [Releases](https://github.com/huangbinjie/pawprint/releases/latest), unzip it, and move `Pawprint.app` to Applications. The current beta is unsigned, so macOS may ask you to allow it to open. In Preferences → App updates, Pawprint checks new releases and can download, verify, and install one after you click **Download and install**.

## Develop

Requires Node.js 22.12+ and macOS for the desktop app.

```sh
npm ci
npm run dev
```

Run `npm test` for core checks and `npm run package` for a local Apple silicon build. Pushing a version tag builds and publishes a Mac archive through GitHub Actions; changes to `site/` deploy the website through GitHub Pages.

Pet data stays in the local app profile. There is no account, cloud sync, cash top-up, or online trading.

See the [changelog](CHANGELOG.md) for release history and [product notes](docs/PRODUCT.md) for detailed behavior.
