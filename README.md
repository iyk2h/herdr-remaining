# Remaining

A compact subscription-limit monitor for the [Herdr](https://herdr.dev) sidebar. See how much is left in your Claude and Codex accounts without opening another dashboard.

This is a local draft. Public release and gallery submission are on hold.

![Bars and Rings with synthetic example accounts](preview.png)

Local source maintenance, updates and rollback are documented in [the maintenance guide](docs/maintenance.md). The running widget's appearance is preserved across these maintenance operations.

- Finds supported Claude and Codex launch definitions in Herdr's `programs.json`, plus existing default CLI logins. Reuses their names and account directories; duplicate directories appear once.
- Default **Bars** view shows independent `5h` and `7d` remaining values in aligned columns and one weekly bar. Choose **Rings** in settings for small quota dials. A column appears only when a monitored account reports that window. Accounts without it keep an empty aligned slot; refresh failures retain an unavailable readout and explanation on hover. Missing values never mean 0% or unlimited.
- Both built-ins keep the same row positions, name width and quota columns when switching styles.
- Reset countdowns appear below account names in 10px text, with a clear gap above the weekly bar. Both styles share compact 32px rows. Exact local reset times remain on hover.
- The refresh icon spins while checking limits. Failed updates show **Retrying**, with saved-value age and account errors on hover.
- Right-click an account to **Open official usage**. The page uses the browser's signed-in account, which may differ from your CLI login.
- AI troubleshooting: run `/bin/sh ~/.config/herdr-app/mods/remaining/launch.sh --diagnose` for an offline JSON report without account identities, paths, tokens or quota amounts. Exit codes: healthy `0`, warnings `1`, errors `2`. See `AI.md` for next steps.
- Settings → **Copy diagnostics** puts a shareable report on the clipboard, with private and free-form fields removed.
- AI account selection: `launch.sh --recommend --provider codex` (or `claude`) recommends a fresh, enabled account from the saved general quotas. Exhausted, failed, stale and reset-pending accounts are excluded. This local report contains account IDs and quota values; it does not launch agents or change logins.
- Add `--refresh` to query through the existing collector and then recommend, using the same lock and 10-second manual-refresh throttle. A failed or still-pending refresh returns no recommendation.
- Add `--model <exact-id-or-name>` when a matching model-specific quota is reported. It combines that quota with general limits. Unreported model capacity is labelled unknown and produces no model-specific recommendation; generic billing buckets are never guessed to be models.
- Settings → **Copy settings** / **Restore settings** back up and restore appearance, account order, pauses and refresh interval as clipboard JSON. AI can export the same backup using `launch.sh --settings-backup`. No credentials, emails or paths are included; custom theme files are separate. See `AI.md` for account/theme mismatch behavior.
- Hover for the signed-in account, all supported windows, exact local reset times, last successful update, and connection errors.
- The gear opens monitoring settings: pause individual accounts, reorder using arrows, and choose a 1, 5, 10 or 15 minute refresh interval. Settings persist through Herdr's shared state.
- Add AI-authored presets as `themes/<id>.json`, using the included JSON Schema. Presets appear in settings automatically. See [the AI guide](mods/remaining/AI.md).
- Default refresh is 5 minutes after the oldest successful account check. Provider errors retry after a minute; stale values are labelled and retain their original age. A manual refresh is throttled to at most once per 10 seconds.
- No account-management or login wizard. Add agents or reconnect their CLI logins through your AI assistant.

## Requirements and installation

Tested locally on macOS with Herdr, Node.js 18+ and existing Claude Code / Codex subscription logins. The Codex CLI must support `--no-daemon app-server` and account/rate-limit RPCs. Linux credential-file paths are implemented but have not been live-tested. Windows is not supported by the shell launcher.

Read `~/.config/herdr-app/AGENTS.md` first. Run `npm run build:release`, then install the resulting package with `node tools/releases.mjs install --release /absolute/path/to/dist/<release-id>`. An existing mod is protected; see [migration and updates](docs/maintenance.md). Add this block to your personal sidebar:

```json
{
  "id": "remaining",
  "type": "block",
  "size": { "px": 132 },
  "min": 112,
  "content": { "mod": "remaining" }
}
```

132px fits three accounts in either built-in style; larger custom sizes or additional accounts can scroll. Under 160px wide the widget shows badges and a percentage. Reset details remain in the hover tooltip.

Clone a shipped layout before editing it. Preserve existing panels and keys. If the name `remaining` is taken, rename the new mod folder, `MOD` in `main.js`, its layout reference, and `data/remaining` in `usage.mjs` to avoid sharing caches. Check with `herdr-app check <installed-mod-folder>` and inspect the actual sidebar.

Herdr commands: `remaining.refresh`, `remaining.settings`, `remaining.bars` and `remaining.rings`. There are no default keybindings.

## Account detection and advanced configuration

Detection reads direct `claude` / `codex` launch arrays and `/usr/bin/env CODEX_HOME=… codex` or `CLAUDE_CONFIG_DIR=… claude` declarations. It reads the declaration; it never executes the original launch array or evaluates shell scripts. Shell wrappers and other providers require an AI-assisted explicit configuration. Detection concerns accounts on the computer running this mod, not logins on remote machines.

To override discovery, copy `accounts.example.json` to **local-only** `accounts.json` inside the installed mod and adjust it. This file replaces the discovered list. It is ignored by Git. An empty array disables all monitoring.

Each account has `id`, `provider` (`claude` or `codex`), and optional `label`, `home`, `badge`, `tint`, `expectedEmail`, `codexBin`, `metadata`, or `keychainService`. Paths must be absolute or start with `~/`. Use one Codex home per login. The optional `expectedEmail` prevents accidentally displaying a different signed-in identity. Custom Claude homes use `<home>/.claude.json` for account metadata and `<home>/.credentials.json` for credentials; a non-default macOS Keychain service must be specified explicitly. Up to 20 profiles are supported.

An unverified or changed login clears the old numbers. Unknown quotas display `—`, never a guessed 0%. Expired reset timestamps remain “Reset pending” until the provider supplies new data. This widget does not estimate paid API credit balances or control which account an agent runs under.

## Programs, files and network

The native view executes `launch.sh` through `/bin/sh`. The launcher finds Node through PATH, Homebrew, `/usr/local/bin`, or `~/.local/bin`. For nvm/asdf-only installs, make Node available to Herdr's environment.

The collector reads Herdr's `programs.json`, optional local `accounts.json`, Claude login metadata and credentials, and starts an isolated Codex app-server for account RPCs. It sends no model prompt, starts no conversation, and terminates only its own child process. Codex manages its own CLI authentication state.

Claude credentials come from `.credentials.json` or the configured macOS Keychain service. The token is used in memory for `https://api.anthropic.com/api/oauth/usage`; redirects are rejected. That endpoint is undocumented and may change. Credentials are not printed, copied into the mod, or included in snapshots. The mod does not implement login or token refresh.

Account emails and normalized limits are cached locally at `$HERDR_APP_HOME/data/remaining/usage.json` (default `~/.config/herdr-app`). The directory is mode 0700, the file 0600. The view also stores its last snapshot and preferences in Herdr's local shared state. No mod telemetry or third-party reporting service is added. Never publish your installed config, cache, shared state, or real account screenshots.

## Development

There are no npm dependencies. Run `npm test` for profile discovery, identity isolation, quota normalization, refresh scheduling, settings, recommendations and release transactions. `npm run check:native` checks synthetic native states; it does not verify paint or pointer interaction. `npm run preview` briefly opens an example-only native popup, captures `preview.png`, and closes it. The private full-window capture stays under ignored `.local/`. No quota notifications are sent.

Icons are from Lucide, distributed under the notices in `mods/remaining/icons/LICENSE.txt`.
