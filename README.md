<a id="pawprint"></a>

# Pawprint — Your work has company

**A little desktop cat. A better way back to your Codex work.**

[Download v0.17.3](https://github.com/huangbinjie/pawprint/releases/tag/v0.17.3) · [Website](https://huangbinjie.github.io/pawprint/) · [Chinese](README.zh-CN.md)

Pawprint is an independent desktop companion for Windows x64 and Apple silicon Macs. It keeps useful work shortcuts beside a cat that grows with your local Codex activity. No API key or extra model requests are needed for the pet, reminders or games.

![A cream tabby Pawprint companion](site/pet.png)

## Small paws, useful shortcuts

| When… | Your companion helps you… |
| --- | --- |
| You return to work | Double-click your cat to open a pending question or approval, then the latest unread reply, then your most recent chat. |
| Codex needs a decision | Click the wooden sign for a supported approval or question request to return to that chat. Pawprint never approves or answers for you. |
| You leave a task unfinished | Save a short next-step bookmark. Your note appears beside the cat when you return. |
| A reply finishes while you are away | Keep an unread marker until you open or mark the chat as read. Choose a gentle sound, system notification or quiet reminders. |
| You want a small break | Play a short game, build practice and bond, and unlock toys, keepsakes and room decorations. |

A reply ending is treated as a reply ending. Running or uncertain parallel tasks suppress completion celebrations.

## A companion of your own

- **Inherited looks:** Coat, eyes, ears and tail come from genes. Browse trait odds, hatch eggs and breed new combinations.
- **Quiet company:** Wandering, a toy ball, cursor glances and occasional greetings. Double-click the cat to return to work. A gentle hop marks an ended reply; a clickable wooden sign stays while a request needs you. Status bubbles and unread arrows also return to the associated chat.
- **A room that grows with it:** Ball, feather and hide-and-seek games build practice and bond. The first three successful rounds per cat each day can earn growth; play and room progress are saved locally.
- **Effort into growth:** Local token usage can earn capped pet-coin rewards. Estimated costs are API equivalents, not your subscription bill or cash assets.
- **Meet other companions:** Share a QR visiting card, or connect nearby homes on your LAN for visits and breeding. Both people choose to connect.

![Pawprint home and inherited cat traits](site/app-home.png)

## Ready on first launch

New installs start in **English** with local usage, quota, session feedback, broad topic labels and quiet reminders enabled. Recent chat metadata loads immediately, without replaying old reply events. Your existing language, reminder choice and explicit opt-outs are preserved on upgrade.

New first eggs hatch into a cream tabby with random hidden genes, talents and skills. Existing pets and eggs stay unchanged. Single-click pets the cat, double-click returns to work, and right-click opens the menu.

Manual approval signs follow pending requests from compatible desktop IPC; automatic review does not trigger a sign. The internal IPC protocol may change with client updates; when unavailable, approval signs are suppressed. On macOS, Pawprint prepares six clearly labeled question and cleanup hooks. **Review and trust the “Pawprint ·” rows in your client** for question updates. Existing rules are preserved and backed up; obsolete Pawprint approval hooks are removed. Structured local questions also provide reminders without hook trust. Native hook setup is currently macOS-only; chat return requires a compatible Codex desktop client.

## Usage close at hand

See 30-day token history, daily priced costs and per-model input, cache-read, cache-write and output details. Remaining five-hour and weekly quota comes from recent local snapshots; it is not a live account query. Mac shows quota in the menu bar, Windows in the tray menu.

The price catalog comes from [models.dev](https://models.dev/), refreshes automatically and retains an offline cache. API-key models used through Codex are matched by provider and model ID. Unknown or incomplete pricing stays visible as pending. Priced usage can earn today's rewards; repeated refreshes do not duplicate rewards, and incomplete or conflicting usage records pause redemption.

## Codex Assistant

The Assistant also includes local chat search with fuzzy matching, batch archive/unarchive, and confirmed permanent deletion. Overload retries run immediately up to **5 times per round**, wait **30 seconds between rounds**, and stop after **3 rounds (15 retries)**. Clicking Retry manually resets both counts and cancels the old cooldown. Stop or successful completion ends the retry chain.

On macOS, choose **Night Companion**, **Sunny Cat Room** or **Sunny Puppy Room** under **Skins**. Previews ship with the app; videos download from GitHub with progress, size and SHA-256 verification, then work offline. QQ Music is not required. Keep Pawprint running to restore the selected skin after client restarts. Native capabilities such as image generation use the official account connection rather than the chat Provider; availability still depends on the account and client.

Manage connections, chat helpers, usage and advanced settings in one page. On **macOS**, add a custom Responses-compatible API provider with its key stored in Keychain, then change the default connection without quitting Codex. Configuration changes are backed up. Recognized file-based ChatGPT identities stay available across client restarts through a local inference bridge; keep Pawprint running and restart Codex once after the first upgrade. Changing the default affects new chats; existing chats retain their bound service after reloads and restarts. Both official GPT and third-party inference use the local router, so keep Pawprint running. Older chats migrate using observed routes when available and official GPT otherwise; remote chats are managed by the client.

Verified local third-party chat titles can carry a provider prefix. Usage shows saved provider names, tokens and model-based reference costs; unmatched models stay unpriced. Reference costs are not your provider's bill or balance. Provider deletion opens a centered confirmation dialog with progress and retry. Local paths are collapsed and public examples use generic data.

Third-party connections preserve account entries by default; availability depends on your account and client. The menu bar immediately shows the selected provider name, then restores local quota snapshots when switching back to ChatGPT / OpenAI. Use the provider dashboard for third-party balances and quotas.

Third-party connections respect the Codex model picker when their configured model ID appears in the native model list. Models absent from that list, such as MiMo, use the connection's configured model for chat, title generation and compaction, even if the picker still shows GPT. A failed model-list read preserves the picker and displays a retry notice. No model-catalog replacement or reload is required; ChatGPT / OpenAI continues to use native model selection.

See [Codex Account Manager details and limits](docs/codex-account-manager.md).

If macOS Tahoe hides Pawprint when another application’s menu-bar toggle is off, the Release includes an optional [menu-bar association repair tool](https://github.com/huangbinjie/pawprint/releases/download/v0.17.3/Pawprint-macos-menubar-association.py) and SHA-256 file. It previews by default; `--apply` backs up and removes only foreign Pawprint associations, with rollback on failure. It requires a terminal with Full Disk Access and refreshes ControlCenter/user preferences services without restarting Pawprint or Codex. [Usage notes](docs/releases/v0.15.4.md).

## Install

- [Windows 10/11 x64 installer](https://github.com/huangbinjie/pawprint/releases/download/v0.17.3/Pawprint-0.17.3-win-x64-setup.exe)
- [Apple silicon Mac archive](https://github.com/huangbinjie/pawprint/releases/download/v0.17.3/Pawprint-0.17.3-mac-arm64.zip)
- [Release notes and SHA-256 files](https://github.com/huangbinjie/pawprint/releases/tag/v0.17.3)

Verify the accompanying checksum. Windows beta builds are unsigned; run the installer and retain your existing app data. Mac beta builds have a complete ad-hoc bundle signature but are not Developer ID signed or notarized. Move Pawprint to Applications. If macOS cannot verify the developer, choose Done, then **System Settings → Privacy & Security → Open Anyway**. If macOS says damaged, stop and report that build. See [Mac signing and installation](docs/RELEASE_SIGNING.md) and [Windows support](docs/WINDOWS.md).

## Local by design

Pets, bookmarks, rooms and usage data stay in your local profile. Work helpers read local Codex records; optional broad topic labels classify new messages locally. Reminder journals do not retain question text, tool arguments or transcripts. Price catalogs and update checks use their existing network sources. Nearby visits are optional and use your LAN.

API chat, local model management and client voice shortcuts are retired in v0.13.0. Previous provider files are preserved and no longer loaded. See the [retirement note](docs/ASSISTANT.md).

Pawprint is an independent app and is not affiliated with OpenAI. It does not read browser ChatGPT conversations or make decisions on your behalf.

## Develop

Requires Node.js 22.12+.

```sh
npm ci
npm run dev
```

`npm test` runs core checks; `npm run test:ui` runs desktop interaction checks. Use `npm run package:local` for an ad-hoc signed Apple silicon build, or `npm run package:win` on Windows for an x64 installer. Version tags build the Mac archive and Windows installer; publishing waits for both builds and their checks. Changes in `site/` deploy through GitHub Pages.

See the [changelog](CHANGELOG.md) for release history.
