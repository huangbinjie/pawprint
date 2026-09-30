<a id="pawprint"></a>

# Pawprint — GPT desktop pet for Windows and Mac

[English](README.md) · [简体中文](README.zh-CN.md) · [Website](https://huangbinjie.github.io/pawprint/) · [Download](https://github.com/huangbinjie/pawprint/releases/latest)

Pawprint is an independent GPT desktop pet for Windows x64 and Apple silicon Macs, powered by local Codex activity. It turns local Codex activity and GPT-model token usage into a small companion that grows alongside your work. The app runs locally; nearby visits and breeding use your LAN.

![Pawprint's cream tabby companion](site/pet.png)

## What it does

- **Floating pet:** A small cat on your desktop that reacts to local Codex work, blinks, plays, and keeps its inherited look.
- **Codex usage:** Reads local Codex records to show token usage, model-aware estimated cost, and capped pet-coin rewards. Estimates are not your subscription bill.
- **Menu bar quota:** Shows remaining weekly and five-hour Codex quota beside its icon when a recent local snapshot exists. This is not a live account query.
- **Genes and skills:** Hatch an egg, browse trait odds, train skills, and breed new combinations.
- **Nearby homes:** Invite another Pawprint user to visit over your local network; chat text and usage records stay on your computer.

Pawprint is an independent app and is not affiliated with OpenAI.

## Install

Download the latest Mac archive from [Releases](https://github.com/huangbinjie/pawprint/releases/latest) and verify its SHA-256 file. The beta has a complete ad-hoc bundle signature but is not Apple Developer ID signed or notarized. On first launch, macOS may say it cannot verify the developer: choose Done, then System Settings → Privacy & Security → Open Anyway for Pawprint. If macOS says **damaged**, stop and report that build. See [Mac beta signing](docs/RELEASE_SIGNING.md).

Windows builds use `Pawprint-<version>-win-x64-setup.exe` with an accompanying SHA-256 file. The v0.11.8 Windows installer is published. Windows CI passed the core tests and packaged-app startup and preference-persistence checks; interactive desktop and cross-platform LAN behavior still need hands-on verification. Windows updates open the official release page for manual installation.

## Develop

Requires Node.js 22.12+ and macOS or Windows 10/11 x64 for the desktop app.

```sh
npm ci
npm run dev
```

Run `npm test` for core checks and `npm run package:local` for an ad-hoc signed local Apple silicon build. The release workflow verifies its complete signature before publishing. Run `npm run package:win` on Windows to build the x64 installer. Windows CI builds the installer and smoke-tests the packaged app. See [Windows support and verification](docs/WINDOWS.md). Pushing a version tag builds and publishes a Mac archive and Windows installer through GitHub Actions; changes to `site/` deploy the website through GitHub Pages.

Pet data stays in the local app profile. There is no account, cloud sync, cash top-up, or online trading.

See the [changelog](CHANGELOG.md) for release history and [product notes](docs/PRODUCT.md) for detailed behavior.

### Pet assistant (experimental)

Opt in from Preferences and connect your own Ollama / LM Studio server, or a MiMo, DeepSeek, OpenAI or compatible API key. Each pet has its own personality, text chat and optional website/app actions. End conversations anytime. The Ollama catalog downloads, tests and connects models in one flow; no inference runtime or voice listening is bundled. See the [setup guide and limitations](docs/ASSISTANT.md).

### 自动模型价格与用量明细

内置 Codex 读取器统计最近 30 天本地用量。价格目录来自 `https://models.dev/api.json`，每天自动更新；出现待定价模型时以 15 分钟间隔尝试刷新。断网保留最近成功缓存；首次离线使用随应用附带的 OpenAI 价格兜底。价格目录请求不上传对话、用量记录或 API key。

同一个 Codex 客户端通过 API key 接入其他模型时，按日志的 `model_provider` 和模型 ID 匹配目录，不将任意供应商套用 OpenAI 价格。自定义供应商别名、未收录模型或缺少服务档位价格会显示待定价；价格目录本身不能补出客户端没有记录的 token。

明细包含模型、供应商、输入 token（包含缓存部分）、缓存读取/写入、输出 token、每日已定价费用及待定价记录。费用是 API 等价估算，并非订阅账单。已定价部分可领取当天奖励，新增可定价用量补算差额；重复刷新不重复发放。日志结构冲突、扫描不完整或过期报告仍暂停兑换。价格更新会使解析缓存重新计价，原始使用记录不变。

子代理日志以首条 `session_meta` 为当前会话身份。明确历史边界内的祖先元数据只作为继承记录处理，不替换当前模型供应商、会话 ID 或计数基线；没有明确边界时，只接受创建时间早于子会话且 ID 匹配声明父会话的元数据。继承用量不兑换，归档镜像逐条去重；边界外或无法验证归属的身份变化仍报告结构冲突。此行为参考 CodexBar 的 leaf metadata 与 inherited prefix 处理。
