# Codex Account Manager (macOS)

Pawprint manages Codex's user configuration independently of Pawprint's own AI features. Click the desktop pet, then **Codex 账号与 Provider**. The native menu marks the configured selection. **添加 / 管理 Provider…** opens Preferences, where you can add a name, Base URL, API key and model, refresh status, select a provider, or delete a provider, including the selected one. Deletion asks for confirmation; when the selected provider is deleted, ChatGPT defaults are restored before its credential is removed. If configuration conflicts prevent restoring ChatGPT, deletion is refused. Double-click still returns to a Codex chat.

You can switch defaults while Codex is running. Start a new chat afterward and confirm its Provider and model. Pawprint does not terminate processes, restart Codex, or claim that an existing chat or the Desktop account indicator has changed. A client that passes explicit cached model/provider overrides can override the new file defaults.

## Credentials and configuration

- API keys are generic-password entries in the macOS login Keychain, under service `studio.binmax.pawprint.codex-provider`. Saving uses stdin, not command-line arguments. Keys are never returned to the renderer or written to TOML, Pawprint's metadata or backups. macOS may ask to unlock or authorize Keychain access.
- Codex uses `[model_providers.<id>.auth]` with `/usr/bin/security find-generic-password ... -w`. This uses the supported command-backed token protocol; no environment-variable injection, replacement of `auth.json`, or logout/login is needed.
- Actual configuration home is `CODEX_HOME`, when inherited by Pawprint, otherwise `~/.codex`. The usage-import directory selected in Pawprint does **not** change the account manager's target. Inspect the displayed configuration path before switching.
- Only top-level `model` and `model_provider` plus a marked Pawprint provider block are changed. Definitions for all saved Providers remain in that block when switching or restoring ChatGPT so existing custom-provider chats can still resolve their original Provider. Deleting a Provider removes its Keychain credential and can prevent those old chats from making further requests. Other fields, comments, project settings and provider definitions are retained. Parsed TOML is compared before and after to reject ambiguous modifications.
- Each switch creates a private (0600) full TOML backup in `<Codex home>/pawprint-account-backups/`. Existing sensitive values in a user's original configuration are present in that full backup; Pawprint does not add its API keys to it.
- The original OpenAI model/provider lines are restored when selecting **当前 ChatGPT / OpenAI 登录**. Pawprint leaves `auth.json` and Codex's own Keychain entries untouched. This label refers to the existing OpenAI login, and does not certify that the user has a valid ChatGPT subscription or token.
- A lock prevents concurrent Pawprint switches. A final config recheck and atomic replacement reduce external-write races. Other tools do not honor Pawprint's lock; no filesystem API can guarantee a compare-and-swap against an uncooperative writer. Externally edited managed fields cause a refusal instead of an overwrite. Changes to unrelated fields are retained.
- A private transaction record resolves interrupted writes on the next load. If a process is killed mid-switch, verify the configuration and backup before removing a leftover `.pawprint-account-lock` directory. If model fields or the marked block were externally changed, reconcile those fields with the backup before retrying; there is no automatic force-overwrite/reset button.

## Compatibility and limits

The gateway must implement the **Responses API**, including the streaming/tool behavior needed by Codex. An “OpenAI-compatible” service with only Chat Completions is insufficient. There is no remote provider connectivity test, model discovery UI, or automatic protocol translation in this version.

Requires a Codex version with command-backed provider authentication. On 2026-10-15, the installed `codex-cli 0.162.0-alpha.17.2` was tested using one continuously running app-server, an isolated private Codex home, real temporary Keychain entries and a loopback mock Responses server. The test switched OpenAI → Provider A → Provider B → OpenAI without restarting. Fresh threads sent requests with the corresponding Provider A/B model and dummy bearer token and completed streamed mock replies. After restoring OpenAI, an existing Provider A thread also completed another request using A, confirming retained provider definitions. A fresh OpenAI thread using the user's authorized existing ChatGPT login replied `PAWPRINT_CHATGPT_OK`. The original user configuration and login file were not changed; the temporary login copy and dummy Keychain entries were deleted afterward.

This verifies live backend defaults, credential routing and return to ChatGPT, **not the Desktop frontend**. Computer Use explicitly denied access to `com.openai.codex`, so the client’s **bottom-left** account/Provider indicator and Desktop-created thread overrides remain unverified. No alternate UI automation was used to bypass that restriction. The UI therefore reports “defaults updated,” asks the user to confirm Provider/model in a new chat, and does not claim a verified client-wide switch or indicator refresh.

Multiple ChatGPT login identities are not implemented. Existing custom default providers, active `profile`, forced API login, malformed TOML, symlink configuration files and ambiguous model-line syntax are refused rather than silently overridden. Model-specific user options remain intact and can be incompatible with a third-party model. macOS is the only supported platform; Windows shows an unavailable manager.

## Verification

- `npm test`: unit tests including configuration preservation, live switching, retained definitions, external edits, deletion, missing credentials, URL validation, symlinks, locks, restart and interrupted transactions.
- `PAWPRINT_KEYCHAIN_TEST=1 node --test --test-name-pattern='real macOS' tests/codex-accounts.test.mjs`: one temporary dummy Keychain entry, removed afterward.
- `node scripts/test-codex-accounts.mjs`: running app-server + streamed loopback Provider A/B test, no remote API calls; creates and removes dummy Keychain entries. Requires macOS and `codex` on PATH. Add `--chatgpt` only with user authorization to copy the existing login into a private temporary home and send one real OpenAI test message; cleanup removes that copy.
- `npx playwright test tests/codex-accounts-desktop.spec.mjs`: actual Electron native menu construction, pet click, current selection, add/delete form, password clearing, enabled runtime switching, restoring ChatGPT defaults and the IPC window boundary.
- Existing double-click navigation and full English UI/restart tests also passed.
- `npm run build` builds the renderer; `npm run package:local` creates an ad-hoc signed local macOS application, not a notarized release or installation.

Official contract: [Advanced configuration](https://developers.openai.com/codex/config-advanced) and [configuration reference](https://developers.openai.com/codex/config-reference).

## Provider labels in chat titles

Enabled by default under **Provider 标题标注**. Hook events trigger a scan, with a 15-second fallback poll when a turn does not invoke hooks. Pawprint reads local per-thread `model_provider` plus explicit title metadata, then verifies the provider through `thread/read` before using the supported `thread/name/set` interface to add `[Provider name] `. It does not derive providers from current defaults or rewrite Codex's SQLite database directly. No model request, prompt, approval, or frontend injection is used for naming.

OpenAI chats, archived chats, subagents, unknown providers and threads without explicit titles are skipped. Provider names come from saved account metadata, then configuration, then the recorded provider ID. Remote-only threads cannot be labelled without authoritative local metadata and are left unchanged. Each scan considers the 64 most recently updated eligible local chats. Existing non-OpenAI chat titles may be labelled as well as new chats.

Duplicate prefixes are avoided. Custom user prefixes are retained; when the client's automatic title changes, the provider prefix is reapplied. Original titles and applied prefixes are recorded in private `codex-provider-titles.json` for recovery. Disabling stops future changes and leaves existing prefixes in place. The Desktop sidebar may require a list refresh or reopening to show externally updated names; GUI refresh remains unverified because Computer Use cannot access Codex.

Verified with isolated real Codex app-server metadata: Provider A/B titles received their correct prefix, an existing `[Bug]` prefix remained, OpenAI's title stayed unchanged, and a second scan made no duplicate edits.

## Codex Assistant page and usage

The sidebar's **Codex 助手** page groups connections, chat/reminder controls, usage/limits and advanced settings. New Provider fields are in a modal; local configuration, backup and record paths are collapsed in Advanced. Product examples use generic placeholders and do not include the author's account/provider names, URLs or local paths. Saved connection names appear only as the user's actual data.

**用量与额度** aggregates the last seven days of available local token records by their recorded Provider, including input, cached input and output. It does not reassign old usage to the currently selected default. Explicit Provider changes in turn/context or applied settings records are honored. A parser cache revision invalidates older per-file caches so these changes are recalculated.

Reference prices remain separate from real bills. For display-only reference costs, each recorded request model is matched against the existing model-prices JSON (with the bundled offline table as fallback). Ordinary input, cached input, cache writes, output, context tiers and service tiers use the existing pricing rules per request. Provider-specific prices take precedence; otherwise a canonical or unambiguous model match supplies a **reference**, not a claimed gateway rate. Unknown or conflicting model matches remain **未定价**. Partial reference totals are labelled partial. This additional reference value does not change reward/accounting costs. Actual gateway balances, subscription plans and invoices require the provider dashboard or a separate supported billing API. Remote-only records absent from the local data are not counted, and old subscription snapshots are not the balance of the selected third-party connection. This page does not change the pet reward rules.

Usage cards in both Codex Assistant and Usage & Wallet resolve recorded Provider IDs to the saved connection names. A name-only history is retained when deleting a connection so older records can still be labelled; API keys are removed as before. When a managed ID has no recoverable name, the UI shows a generic custom-provider label with a short identifier instead of the full internal ID. Usage & Wallet model cards also use the display-only reference cost fields and their matching unpriced count.
