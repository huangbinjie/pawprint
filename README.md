# Pawprint

[English](README.md) · [简体中文](README.zh-CN.md) · [Website](https://huangbinjie.github.io/pawprint/) · [Download](https://github.com/huangbinjie/pawprint/releases/latest)

A small desktop companion for Apple silicon Macs. Adopt an egg, meet a cat with its own inherited appearance and skills, and let ordinary Codex usage contribute to its growth. Pawprint runs locally; nearby visits and breeding work over your LAN.

![Pawprint's cream tabby companion](site/pet.png)

## Install

Download the latest Mac archive from [Releases](https://github.com/huangbinjie/pawprint/releases/latest), unzip it, and move `Pawprint.app` to Applications. The current beta is unsigned, so macOS may ask you to allow it to open. In Preferences → App updates, Pawprint checks new releases and can download, verify, and install one after you click **Download and install**.

## Develop

Requires Node.js 22.12+ and macOS for the desktop app.

```sh
npm ci
npm run dev
```

Run `npm test` for core checks and `npm run package` for a local Apple silicon build. Pushing a version tag builds and publishes a Mac archive through GitHub Actions; changes to `site/` deploy the website through GitHub Pages.

Pawprint reads Codex usage records on your Mac to estimate rewards. Pet data stays in the local app profile. LAN pairing does not share chat text or usage records. There is no account, cloud sync, cash top-up, or online trading.

See the [changelog](CHANGELOG.md) for release history and [product notes](docs/PRODUCT.md) for detailed behavior.
