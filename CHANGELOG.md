# Changelog

Release notes for published Pawprint builds. Builds are available for Apple silicon Macs and Windows x64.

## 0.16.0 — 2026-10-28

- macOS 预制动态皮肤：三套预览、GitHub 按需下载与离线缓存，修正猫咪待机循环。
- 本机会话模糊搜索与批量归档、取消归档、确认删除。
- 过载每轮立即重试 5 次，轮间等待 30 秒，最多 3 轮；用户主动重试重新计数。
- 原生能力使用官方账号连接，聊天继续遵循绑定 Provider；补齐英文与中英文官网说明。
- Add three preset macOS skins with verified on-demand downloads and offline caching; correct the cat idle loop.
- Search and batch-manage local chats. Retry overloads up to five times per round, three rounds, with 30-second cooldowns and manual reset.
- Route native capabilities through the official account; complete bilingual Assistant copy and website updates. Update Electron to 44.10.0.
- [完整说明 / Full notes](docs/releases/v0.16.0.md)

## 0.15.4 — 2026-10-23

- macOS 会话持久绑定服务，切换默认 Provider 只影响新会话；重载、重启后保持绑定，删除原连接后明确报错。
- 显示新会话默认服务与会话绑定来源；回到官方请求后恢复 Pawprint 自己标注的标题，保留手动标题。
- 删除 Provider 使用居中确认弹窗，展示进度、失败提示并支持重试。
- 修复官方转发因 Electron 不接受请求长度／Fetch Metadata 头而返回 502 的问题。
- 附带需手动执行的 Tahoe 菜单栏关联修复工具：先备份、仅解除 Pawprint 错误关联、失败尝试回滚，不重启 Pawprint 或 Codex。
- Persist chat services across reloads/restarts, clarify defaults and bound sources, and preserve manual titles.
- Use a visible deletion dialog and fix official forwarding request framing that caused local 502 errors.
- Include a manual, backed-up macOS menu-bar association repair tool; it does not reset the layout or restart Pawprint/Codex.
- 升级后官方与第三方请求都需本机路由，请保持 Pawprint 运行；无转发记录的旧会话迁移到官方 GPT。

完整中英文说明 / Full bilingual notes: [v0.15.4](docs/releases/v0.15.4.md).

## 0.15.2 — 2026-10-23

- macOS 第三方连接按原生模型列表决定是否保留聊天框选模；MiMo 等列表外模型使用配置模型，支持运行中新增连接。
- 保留工具调用所需的协议头和流式、压缩响应，同时过滤凭据、身份和逐跳头。
- 根据准确的会话与轮次记录展示新增 MiMo 用量，补充小米 API 参考价格；历史缺少证据的记录保持原标注，参考费用不等于实际套餐扣费。
- Preserve native model selection for listed models and pin unlisted connection models, including MiMo, without replacing the client catalog.
- Forward feature headers and encoded streaming responses while filtering credentials, identity and hop-by-hop headers.
- Attribute new MiMo usage by exact thread/turn evidence and show Xiaomi API reference costs separately from subscription billing.
- macOS 菜单栏入口不显示的反馈仍在调查，本次未修复。The reported missing macOS menu-bar entry remains unresolved.

完整中英文说明 / Full bilingual notes: [v0.15.2](docs/releases/v0.15.2.md).

## 0.15.1 — 2026-10-22

- 降低宠物动画 CPU 占用；隐藏或离屏时暂停基础动画更新。
- macOS 第三方连接默认保留 Dot 等账号入口，移除兼容开关与权限自动判断，保留实际服务名称和官方配置恢复。
- 修复原生客户端压缩请求引起的 `Invalid JSON request`，改善 HTTP 回退。
- 更早为正式标题添加 Provider 前缀；初始临时标题保持客户端行为。
- 菜单栏在 Provider 名称和官方额度之间即时切换；第三方空额度记录不再覆盖已知官方快照。
- Optimize pet animation scheduling and pause hidden/offscreen baseline motions.
- Preserve account-service compatibility by default for macOS providers, without a mode switch or entitlement detector.
- Decode compressed native requests, improve HTTP fallback and label generated titles before replies complete.
- Immediately show the selected provider name or official quota in the menu bar; keep empty proxy quota records from replacing official snapshots.

完整中英文说明 / Full bilingual notes: [v0.15.1](docs/releases/v0.15.1.md).

## 0.15.0 — 2026-10-17

- Preserve recognized file-based ChatGPT identity across Codex restarts while using custom Providers on macOS. A local inference bridge uses Provider keys from Keychain and strips ChatGPT credentials and identity headers before forwarding. Keep Pawprint running; restart Codex once after the first upgrade. The client Usage menu shows ChatGPT account limits, separately from third-party usage.
- Request an immediate refresh of the local Provider indicator after verifying the written configuration. Delivery has no UI acknowledgement. Send silent system notifications for switch results and offer shortcuts to Pawprint's notification settings; no custom desktop overlay is shown.
- Explain configuration conflicts by changed field and offer explicitly reviewed, backed-up restoration to ChatGPT. Refuse stale confirmations and changes that cannot be safely isolated; retain unrelated settings and login data.
- Show recent recorded chat Providers and models independently of the new-chat default. Unknown sources remain unconfirmed; empty chats may not yet be recorded. Reading metadata sends no chat message and does not verify API connectivity.
- Give newly claimed first eggs a fixed cream tabby appearance with random hidden genes, talents and skills. Existing pets/eggs and discovery/breeding rules are preserved; update gene-catalog probability descriptions.
- Single-click pets the cat without opening a menu. Right-click opens the menu; double-click returns to a chat.

## 0.14.2 — 2026-10-15

- Fix switching back to ChatGPT after choosing a different model in Codex. Normal model selections and equivalent configuration formatting no longer block connection switches; external provider or connection changes still require review.
- Remember the most recent OpenAI model choice when switching away and restore it when returning to ChatGPT.
- Show switching progress, success and configuration errors beside the selected connection so feedback stays visible.
- Changing the default connection while Codex runs still applies to new local chats; existing and remote chats are not automatically migrated.

## 0.14.1 — 2026-10-15

- Bring connections, chat/reminder controls, provider-aware usage and advanced settings together in the new Codex Assistant page. Use a modal to add connections and keep local paths collapsed by default.
- On macOS, manage custom Responses-compatible Codex API providers with keys stored in Keychain. Back up configuration, preserve ChatGPT login and unrelated settings, and allow changing defaults while Codex runs. Existing chats do not automatically switch; remote execution is not guaranteed to use local defaults.
- Delete a selected provider by restoring ChatGPT defaults first, with confirmation and configuration conflict checks. Retain name-only history so old usage cards show connection names instead of internal IDs.
- Optionally prefix verified local third-party chat titles with their provider name. Leave OpenAI, archived, subagent and unverified remote chats unchanged; avoid duplicate prefixes.
- Attribute tokens to each request's recorded provider. Calculate display-only reference costs from provider/model pricing or a canonical model match, including separate input, cache and output counts. Unknown or conflicting models remain unpriced; actual provider bills and pet reward rules are unchanged.
- Replace personal examples with generic placeholders and clarify local-record coverage, provider balances and subscription snapshot limits. Preserve existing pets, genes, wallet, reminders and preferences.

## 0.13.3 — 2026-10-10

- Show approval signs only for pending manual command, file-change and permission requests observed through compatible desktop IPC. Automatic review no longer raises an approval sign.
- Clear signs when requests are resolved, subscriptions disconnect or an incompatible stream is received. Preserve question reminders and other client hook rules.
- Remove obsolete Pawprint PermissionRequest hooks and old approval markers on upgrade; report subscription availability in client helpers.

## 0.13.2 — 2026-10-09

- Fix stale Bash approval signs after a tool completes: match the command without the approval-only description.
- Refresh the installed hook relay after app upgrades while preserving existing client hook rules.

## 0.13.0 — 2026-10-02

- Work chats beside the cat: return to the active or pinned Codex chat, switch between recent chats with real titles and project names, and keep a local next-step bookmark.
- Approval and question reminders: a quiet bell stays until a request is handled. macOS prepares clearly named Pawprint hooks; client review and trust remain manual. Structured local question records provide a fallback. Pawprint never approves or answers for you.
- Reply reminders: persistent unread markers, optional gentle sound or system notification, and Do Not Disturb. Parallel or uncertain tasks suppress completion celebrations.
- Quiet hover controls with fixed 44 px click targets, reliable held presses, release-outside cancellation and no accidental home opening.
- New installs start in English with local usage, quota, session feedback, topic labels and quiet reminders enabled. Recent chat metadata loads immediately; existing preferences, pins, bookmarks, pets and wallets are retained.
- Play and growth: three short games, per-pet practice and bond, unlockable decorations and a locally saved room.
- Retire API chat, local model management and client voice shortcuts. Old provider files remain untouched and are no longer read; local personality and companionship remain.

This public release includes the work developed in unpublished local previews numbered 0.12.2 through 0.13.12.

## 0.12.1

- Automatically refresh model prices from models.dev, with a local cache and offline fallback. Match API-key models by the provider and model recorded by Codex.
- Show 30 days of usage, daily priced costs, unpriced records and per-model input, cache-read, cache-write and output token details.
- Let priced usage earn today's rewards while unknown models await pricing; avoid duplicate rewards when prices or reports refresh.
- Recognize inherited parent metadata in subagent rollouts without double-counting copied history or archive mirrors. Preserve rewards when upgrading an empty usage baseline.
- Refine QR visiting-card spacing and image import controls, including the hidden file picker.
- Improve usage typography and complete English text for populated reports, pricing states and daily tables.

## 0.11.10

- Download and use recommended Ollama models directly from Pawprint, with progress, cancellation, existing-model discovery, a trial run and automatic connection setup.
- Detect a missing Ollama installation and guide the one-time setup; start an installed local service when needed.
- Add verified in-app Windows updates: download, save and quit, install to the existing location, and restart while preserving user data.
- Show update download progress and notify when a new version is available.

Windows 0.11.9 and earlier still need one manual installation of this version to gain in-app updates.

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
