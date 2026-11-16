# Account settings

## Find existing logins

Remaining reads direct Claude and Codex launch definitions from Herdr `programs.json`.
It also finds existing default CLI logins.
Accounts with the same provider and home directory appear once.

Discovery supports direct launch arrays and these environment declarations:

- `CODEX_HOME` for Codex.
- `CLAUDE_CONFIG_DIR` for Claude.

Discovery reads launch definitions. It does not execute wrappers or shell scripts.
It finds accounts on the computer that operates the mod.
It does not find logins on remote machines.

## Override discovery

1. Copy `accounts.example.json` to `accounts.json` in the installed mod folder.
2. Edit the account entries for your existing CLI logins.
3. Refresh the widget.

This file replaces the discovered account list. An empty array disables all accounts.
The list supports up to 20 accounts.
Paths must be absolute or start with `~/`.
Each Codex login requires a separate home directory.

| Field | Meaning |
| --- | --- |
| `id` | Required unique ID. The format is a lowercase letter or digit, then up to 39 letters, digits, underscores, or hyphens. |
| `provider` | Required value: `claude` or `codex`. |
| `label` | Account name. The limit is 60 characters. |
| `home` | CLI account directory. |
| `badge` | The first character appears in the account badge. |
| `tint` | Badge color: `ansi2`, `ansi3`, `ansi4`, `ansi5`, or `ansi6`. |
| `expectedEmail` | Optional identity restriction. A different login clears the saved values. |
| `codexBin` | Absolute path to the Codex executable. |
| `metadata` | Path to Claude account metadata. |
| `keychainService` | macOS Keychain service for Claude credentials. |

The default Claude home uses `~/.claude.json` for metadata.
A custom Claude home uses `<home>/.claude.json` and `<home>/.credentials.json`.
A custom macOS Keychain service requires an explicit `keychainService` value.

## Provider access

The native view starts `launch.sh` with `/bin/sh`.
The launcher finds Node through PATH, Homebrew, `/usr/local/bin`, or `~/.local/bin`.
Installations that use nvm or asdf must expose Node to the Herdr environment.

Claude access reads existing CLI metadata and credentials.
Credentials come from `.credentials.json` or the selected macOS Keychain service.
The collector sends the token to `https://api.anthropic.com/api/oauth/usage` and rejects redirects.
This endpoint is undocumented and can change.
The mod does not implement login or token renewal.

Codex access starts a separate app-server with `--no-daemon`.
The collector sends only initialization, account, and rate-limit RPCs.
It terminates its own child process after the query.
The Codex CLI manages its authentication state.

Credentials stay in memory during collection.
The mod does not print credentials or copy them into its folder or snapshots.
An account identity change or an unverified login clears old limit values.

## Local data

The cache file is `$HERDR_APP_HOME/data/remaining/usage.json`.
The default app home is `~/.config/herdr-app`.
The cache contains account emails and normalized limits.
The directory mode is `0700`. The file mode is `0600`.

Herdr shared state also contains the last snapshot and Remaining preferences.
Theme files stay inside the installed mod folder.
The optional `accounts.json` stays local and Git ignores it.

Do not publish credentials, account files, usage caches, shared state, or screenshots with real account information.
This mod does not estimate API credit balances or select the login for an agent.
