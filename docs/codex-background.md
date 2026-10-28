# Client backgrounds

Local image/video backgrounds owned by Pawprint, available on macOS. It does not depend on Dream Skin,
change the installed client bundle, or change Provider/login configuration.
Open **Codex Assistant → Skins**. Three preset screenshots ship with the app:
Night Companion, Sunny Cat Room and Sunny Puppy Room. Choose a card to apply it;
the current preset is highlighted. **Original** restores the native appearance.
The user does not select local media files or need QQ Music installed.

Video assets download asynchronously from the independent GitHub resource release
`skin-assets-v1` on first selection. The app reports progress and checks the
pinned byte size and SHA-256 before publishing each cached asset. Failed transfers
remove `.part` files and keep the previous selection. Verified downloads remain
in the private `codex-background/assets` cache for offline switching.
`settings.json` stores the chosen preset. Night Companion automatically pairs
its quiet writing loop with a once-per-new-chat opening animation. The original
file-based script below remains a developer diagnostic, not a product picker.

Sunny Cat Room loops the seated idle clip (`cat-idle-v2`), rather than the
wake-up-to-seated transition. Active selections from the original asset are
upgraded on startup; disabled selections upgrade when selected again. The old
release asset stays available for older app versions.

Keep Pawprint running for automatic restoration. A three-second lifecycle check
detects client restarts and renderer reloads. Media is cached in memory, and only
windows missing the selected revision are reinjected. Closed clients remain closed.
A newly launched client without the connection is gracefully reopened once with
the required arguments. The running client found when Pawprint itself starts is
never automatically interrupted: use **Reconnect client** if needed, which asks
for confirmation. A short launch grace period prevents repeated restart attempts.
Turning the switch off restores visible windows immediately and retained windows
when they become visible, including their original theme. The feature does not
change login or Provider settings.

## Try an image

Validate the selected local file:

```sh
node scripts/codex-background.mjs --check --file /path/to/image.png
```

An existing ChatGPT/Codex process must first be opened with a loopback debug
connection. Reopening the running client can interrupt active chats, so do this
only when the user is ready to quit it normally. After quitting:

```sh
open -na /Applications/ChatGPT.app --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9342
```

Open a Codex chat, then apply or remove the background:

```sh
node scripts/codex-background.mjs --file /path/to/image.png --port 9342 --dim 0.35
node scripts/codex-background.mjs --file /path/to/idle.mp4 --intro /path/to/opening.mp4 --port 9342
node scripts/codex-background.mjs --restore --port 9342
```

The adapter checks listener ownership, loopback binding, the official installed
client executable and its signature before connecting. It selects a visible
Codex main window, preferring the focused one, and sends fixed rendering code
with media bytes passed as data. PNG, JPEG, WebP, MP4 and WebM files up to 32 MiB
are accepted; decoding must succeed before replacing a working background.
Video uses a muted, inline, looping player with cover framing. It pauses when
the document is hidden, resumes when shown, and releases its decoder on removal.
An optional `--intro` video plays once on entry to the active new-chat home
composer, then returns to the idle loop. Ordinary DOM changes and switches
between existing chats do not replay the opening. Retained inactive home routes
are excluded. Both local videos remain Blob resources until restore.

The renderer adds a non-interactive background beneath the original interface,
temporarily selects the native dark palette, and gives the sidebar and composer
coordinated backgrounds. Only the outermost assistant reply gets a light frosted
reading plate; nested Markdown does not add another plate. Text has no stroke.
The composer has a fixed dark background without a backdrop filter, preventing
moving video details from making patches inside the control. The surrounding
reading surface stays transparent; media dimming defaults to zero
and remains available through `--dim`. The composer's separate native backdrop
and footer/header fade surfaces are cleared so they cannot cover the artwork.
Transcript fade siblings outside the composer footer are included as well.
The combined composer-fade variant is also cleared. Native Dot messaging roots
receive their own dark theme, transparent thread panes and matching message
plates; original nested theme attributes are restored on removal. Settings pages
remove only the extra main-frame top margin and empty toolbar spacing, aligning
their content with the sidebar without changing the general window layout.
Retained inactive routes are excluded when choosing the main window's content surface.
Restore removes the layer, stylesheet, attributes and Blob URL, and restores
the original theme. Replacement shell nodes are followed without a polling loop.
Reloading the client removes the renderer layer until Pawprint restores it.
Closing the CDP connection after applying does not close the client's debug
listener. To close that listener, quit and reopen the client normally.

## Verification and limits

`node --test tests/codex-background.test.mjs` checks actual Electron decoding,
pixel visibility through opaque shells, input/click handling, hot replacement,
failed decode retention, restoration, and rejection of a different process.
The fixture uses an isolated profile and cleans it on exit.

The real installed client requires acceptance after the user's restart:
verify the image is visible, messages and composer remain usable, route switching
works, and restore returns the original appearance. This prototype does not
claim that a fixture test verifies the real client's current DOM. Tests include
actual video decoding and playback, pause/resume, and replacement by an image.
The opening/idle transition is exercised in an isolated renderer, including
returning to the idle loop without replaying the opening on normal DOM updates.
`tests/codex-background-manager.test.mjs` covers persistence, client lifecycle,
reload restoration, disabling and damaged settings. The isolated desktop test
`tests/background-settings-desktop.spec.mjs` verifies gallery placement, preview
loading, preset selection and persistence across Pawprint restarts. It never
restarts the real client. Download tests cover checksum/size failures, progress,
offline cache reuse and partial-file cleanup. Videos are release assets rather
than installer payloads; only the small preview JPEGs ship with the UI.
