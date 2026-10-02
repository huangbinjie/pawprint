# AI assistant retired

AI chat, provider setup, API connection tests, model downloads, client voice shortcuts and assistant actions were retired in v0.13.0. The app no longer creates an assistant service, reads provider credentials, starts a model engine or exposes assistant IPC methods.

Previous `assistant.json` settings remain untouched for recovery. Removing the feature does not delete pet history, wallet data, work bookmarks or local save files.

Pet temperament, brief companionship lines, desktop animations, Codex conversation links, work reminders and token pricing remain local companion features. They do not invoke a conversational model. Price catalog and update checks continue to use their existing network sources.
