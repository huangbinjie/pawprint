# Codex capacity retries

In **Codex Assistant → Advanced settings**, use the **Retry model overloads** switch.
The setting is on by default and requires local session feedback. Explicitly saved
off preferences remain off. Keep Pawprint
and the owning Codex desktop client running.

For newly observed root-chat turns that fail with `server_overloaded`, Pawprint
retries immediately, without an added delay, up to five times per round. If the
fifth retry also overloads, it waits 30 seconds from that failure before starting
the next round. There are at most three rounds: 15 retries and two cooldowns.
The original failed turn is not counted as a retry. There is no final cooldown
after the fifteenth failure. The activity poll and local IPC still add their
normal dispatch latency; sleep, disconnection or an unavailable client can delay
or prevent dispatch.

An independent bubble beside the desktop cat, assistant settings, each matching chat card and the small recent-chat panel
show a live countdown such as **Retry in 18s · Round 2/3 · 1/5**. All three read the actual
scheduled deadline; opening a panel does not restart the wait. The countdown
disappears on dispatch or cancellation.
The desktop bubble uses normal 13 px text independently of the pet's scale,
including at the minimum 50% pet size, without enlarging the pet window.

A user clicking Retry starts a fresh budget: round 1, retry 1, with all 15
automatic retries available again. Any existing cooldown is cancelled, including
after exhaustion. Other manual turns also reset the round and attempt counts. A manual continuation, stop, successful completion, disabling the
setting or changing the record directory cancels pending retries. Existing
failures are not replayed on startup. Forked/inherited session files are excluded.

Before dispatch, Pawprint discovers the local desktop thread owner and checks a
fresh version-11 snapshot: the same failed turn must still be latest, the thread
must be idle or in the desktop's `systemError` state, and there must be no pending approvals/questions. It sends the
version-2 `thread-follower-start-turn` request with empty input and
`capacity_retry_automatic`, inheriting the thread's current model, mode and
permissions. It does not replay tool commands or resend the original user input.
No transcript, credential or error body is saved by this feature.
The last-attempt status distinguishes request acceptance, an observed new turn,
and the terminal result; an accepted IPC request alone is not marked successful.

This desktop IPC contract is internal and version-dependent. Unsupported replies
stop the attempt and show that manual continuation is needed. Pawprint does not
modify the desktop application or force-enable its rollout flags.

Verification: unit tests cover retry timing, limits, cancellation and framed IPC;
the isolated Electron test covers the setting, a log failure followed by
five immediate retries followed by the second-round cooldown, and persistence without historical replay on restart.
All inference is mocked; this does not verify live model availability.

## Native button countdown

Inspected the installed desktop bundle on 2026-10-27. Its legacy capacity retry
button only counts down when the current thread is ready, the error belongs to
the latest failed turn, this renderer owns the thread, feature gate `2899820207`
is enabled, and a retry delay is available. The legacy delay sequence is 10, 30,
120 and 300 seconds; consecutive empty-input overloaded turns advance it, and
exhausting the sequence disables the countdown.

The delay selector returns no delay when the host supports `capacityErrorRetries`,
which this build detects from app-server version `0.162.0-alpha.18` onward.
This suppresses the legacy frontend countdown; it does not prove that a failed
turn will be retried by the backend. The inspected failing chat used app-server
`0.164.0-alpha.11.1`.

Neither the inspected desktop IPC registry nor the installed app-server's
generated experimental schema exposed a way to set the native countdown.
`capacity_retry_automatic` records the retry trigger; it does not control that
button. Pawprint therefore displays its own countdown without changing the
desktop bundle, host version or rollout flags.

Official background: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
