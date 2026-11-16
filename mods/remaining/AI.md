# Customize Remaining

Read the host's `~/.config/herdr-app/AGENTS.md` first. This mod is a small display layer over existing CLI subscription quotas. Keep account collection and identity verification separate from appearance work.

## Add a theme without changing JavaScript

1. Read `theme-schema.json`, an existing file in `themes/`, and `examples/compact.json`.
2. Add `themes/<id>.json`. The filename must match the unique lower-case `id`; avoid overwriting an existing theme unless requested.
3. Set `$schema` to `../theme-schema.json`. Provide `id`, `name` and `layout` (`bars` or `rings`). Optional `show`, `sizes` and `colors` control the existing renderers. Unspecified fields use defaults.
4. Validate locally with `/bin/sh <installed-mod-folder>/launch.sh --themes --check`. This only reads theme files; it does not contact providers or read credentials. Errors name the file and invalid field.
5. Herdr reloads the theme catalog when its folder changes. The new name appears under **Appearance** in the gear popup. Select it; the preference persists and does not trigger quota requests. Adding a theme does not select it for the user.
6. Run `herdr-app check <installed-mod-folder>` and inspect the actual widget. The native check cannot prove paint, dimensions or later interactions.

Example:

```json
{
  "$schema": "../theme-schema.json",
  "id": "quiet",
  "name": "Quiet",
  "layout": "bars",
  "show": { "short": true, "weekly": true, "badge": true },
  "sizes": { "font": 11, "rowPadding": 1, "bar": 2 },
  "colors": { "fill": "accent", "secondary": "dim" }
}
```

`bars` is the default and corresponds to the dual-number design: independent `5h` and `7d` values with one weekly bar. `rings` puts the same values into two small dials with column labels. These are supported rendering primitives, not arbitrary executable templates. A new arrangement needs a renderer change in `main.js` and an explicit schema extension; JSON never executes commands or imports code.

Both built-ins share one grid: identical header/column-label space, name width, quota-column width, row height and vertical centers. A 10px reset countdown sits below the name with 11px line height and a 1px gap; with two windows it labels each time `5h`/`7d`. Unknown timestamps add no line and elapsed resets say `Reset pending` until provider data updates. `rowMetrics` reserves at least 2px between the text region and the bottom track; use its `bottom` padding in both styles. Default rows are 32px, so three accounts fit a 132px block. Preserve this shared structure when changing a renderer, so switching the visual treatment does not move or truncate names differently. Larger explicit custom sizes can still require scrolling.

Color values are Herdr semantic tokens (`foreground`, `muted`, `dim`, `accent`, `working`, `blocked`, `border`, `chrome`, `ansi0`…`ansi15`), `profile` for the account's accent, or `#RRGGBB`. Prefer tokens so light/dark themes remain readable. Fixed colors apply in both appearances. Reset countdowns use `colors.text`, like account names: the user treats reset time as primary information. Keep the smaller time text, but do not dim it as secondary metadata.

Keep single-window countdowns concise: a small clock icon followed by `3d 12h`, without a `Resets in` prefix or approximation marker. The decorative icon identifies time without adding a word; its tooltip says Time until limit reset. Two-window summaries retain their `5h`/`7d` labels. The account tooltip gives exact reset times; an elapsed reset still says `Reset pending` until refreshed.

## Preserve the data contract

### A missing five-hour window can be expected

Do not assume every subscription has both windows. As checked on 2026-11-13, [OpenAI's usage documentation](https://learn.chatgpt.com/docs/pricing) says Pro plans currently have no five-hour limit. [Anthropic's Ultra documentation](https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan) says Max 20x subscribers move to Ultra, and verified Ultra accounts have no five-hour limit. Claude's legacy CLI subscription type can still say `max` while its profile's plan display name is `Ultra`.

Compare live plan metadata and raw window presence with current provider policy before diagnosing a parser failure. The monitored accounts were independently checked through the CLI account/profile endpoints; their raw responses expose general weekly windows only. Ultra verification status was not separately returned by the profile API, so the policy match is an inference from the Ultra profile and weekly-only usage response, not a stored verification flag.

Never turn a missing value into 100%, zero or unlimited based only on `null`. A real reported 300-minute window takes precedence over plan-based expectations. Keep uncertain values distinct and avoid fabricating a five-hour percentage from local token totals, which do not provide the allowance denominator.

- `windows[].used` is provider-reported consumption. Convert it to remaining once: `100 - used`, clamped only for display. A small positive value displays `<1%`, not an exhausted zero.
- The `5h` slot uses an unscoped 300-minute window; the `7d` slot uses an unscoped 10080-minute window. `quotaColumns` hides a column when no monitored account reports it, independently of the Bars/Rings choice. Mixed accounts reserve empty slots for alignment, without drawing a missing value or ring; a failed refresh keeps an unavailable readout when its column is present. Provider/refresh reasons remain in the account tooltip. Never copy a weekly percentage into a short window or fabricate missing values.
- A Bars track always refers to the weekly window. Do not automatically swap its time window or combine the two percentages.
- Provider-scoped model/review limits are not general account limits. Do not make their value the account's headline number.
- Keep reset times, identity, errors and last successful fetch in the tooltip. Failed reads stay distinguishable from zero remaining. A passed reset timestamp is not proof of a renewed allowance.
- Do not change account config, refresh intervals, saved order or chosen theme while adding a preset. Theme changes must not invalidate `pollingPreferences`.
- Account ordering lives in settings arrows. Sidebar dragging and quota notifications are intentionally absent.

## Diagnose an installation

Run `/bin/sh <installed-mod-folder>/launch.sh --diagnose`. It prints versioned JSON and exits with `0` for healthy, `1` for warnings and `2` for errors. This is an **offline** check: no provider requests, model turns, credential reads, Keychain prompts, login changes or state writes. A credential file being present does not prove the login is valid.

The report checks account discovery, executable availability, saved query results and age, cache compatibility, preferences and theme validity. Accounts are numbered in the saved display order; paused accounts are marked and excluded from active failure checks. It omits names, emails, account IDs, filesystem paths, tokens, raw error messages and quota percentages. Failure codes and suggested next actions are safe to share. Theme errors use counts; inspect `launch.sh --themes --check` locally for exact filenames/fields.

Settings → **Copy diagnostics** copies a shareable report to the system clipboard. The view applies a second strict field/enum allowlist before copying; raw messages, free-form actions and extra fields are dropped. Valid warning/error reports are copied too, even though the diagnostic exits nonzero. The button shows Checking…, Copied or Copy failed · retry and leaves the clipboard unchanged on invalid output. It never sends the report to another service.

To actively retry an existing account query, use `launch.sh --refresh` separately, then rerun `--diagnose`. The refresh command prints the normal private snapshot, so do not paste or publish its stdout. The diagnostic does not claim that an absent 5h window is an error or proof of unlimited usage.

Account rows support right-click → **Open official usage**. Only fixed Claude/OpenAI HTTPS destinations are allowed; no credentials are embedded in the URL. This uses the browser's signed-in account, which can differ from the CLI login. Enter activates the menu item; Escape dismisses the popup.

The refresh icon rotates natively while collection runs. A failed or partial update shows **Retrying** and exposes last-success details on hover. Reuse cached numbers only under the existing identity checks; a changed/unverified login must still discard old values. Animation must not use JavaScript redraw timers.

## Recommend an account for AI work

Run `/bin/sh <installed-mod-folder>/launch.sh --recommend --provider codex` (or `claude`). Omit `--provider` to get separate groups for all configured providers. By default this reads local configuration and the existing usage cache only: no provider requests, credentials, model turns, state writes, login changes or automatic agent launches. Exit codes are `0` when at least one requested group has a recommendation, `1` when none can be recommended, and `2` for config/runtime/argument errors.

Add `--refresh` to query before recommending: `launch.sh --recommend --provider codex --refresh`. This explicitly invokes the existing collector for all monitored accounts, including other providers, with the saved polling preferences. It uses the same credential handling, account checks, cache, 10-second manual-refresh throttle and collector lock as the widget; no model turn or login change is introduced. A pending collector is polled for at most 90 seconds. Failed/timed-out/pending refreshes return no recommendation rather than quietly using the old cache. After completion, configuration and cache are read again and freshness uses the post-refresh clock. The report's mode is `refresh`, and `refresh` says completed/skipped. It skips collection when the requested provider has no monitored account. Do not assume `completed` means every account succeeded; inspect each provider's recommendation and account states.

Use each provider group's `recommendedId` only when non-null. `eligibleIds` ranks fresh, enabled accounts by their smallest **reported general** remaining percentage, then the earliest reset of that limiting window, then the saved account order. A missing 5h window is not treated as exhaustion or unlimited usage. An exhausted 5h quota excludes an account even when its weekly quota remains. Provider-scoped model limits do not determine this general recommendation.

Paused accounts, explicit usage blocks, missing/invalid quotas, failed queries, incompatible cache sources, timestamps in the future, samples at least one configured refresh interval old and elapsed reset timestamps are excluded. A reset time passing never invents a renewed allowance. `refreshRequired` indicates which groups need a new query; use `--refresh` or refresh separately through the existing collector.

This is a percentage-headroom heuristic based on the last verified snapshot, not a prediction of task capacity, a current login check or a guarantee that every model is available. Plans can have different absolute allowances. The output intentionally includes local account IDs and quota values so an AI can select a configured account; unlike the clipboard diagnostic, it is private local data. It omits names, emails, credential contents, home paths and launch commands. Resolve an ID against the current local profile/registered agent before starting it; do not turn the ID into an executable or silently switch credentials.

To include a reported model-specific quota, add `--model opus` or an exact model ID/display name from the provider's explicit active model scope. Model matching is case-insensitive and whitespace-normalized, never a substring guess. Active Claude model scopes retain their IDs/names; legacy Sonnet/Opus windows retain those exact family labels. The selected model quota is combined with general quotas, so either can exhaust the account. Other models' quotas do not affect this selection.

An account without a reported matching model window is not recommended in model mode, and the result marks modelCoverage as not_reported. The overall status is model_limits_unavailable when this is the only obstacle. That is unknown model-specific capacity, not proof that the model cannot run. Current [Codex protocol documentation](https://learn.chatgpt.com/docs/app-server) defines limitId as a metered bucket ID and limitName as a label, not a model identity; do not reinterpret Review or other generic buckets as models. Use general recommendations when model-specific data is unavailable. Cache schema 3 triggers a fresh read when upgrading from older metadata without model keys.

## Back up and restore settings

Settings → **Copy settings** copies versioned JSON containing the current account ID cohort, display order, monitoring pauses, appearance ID and refresh interval. It excludes emails, account directories, credentials, usage snapshots, custom theme files and other Herdr settings. Save the clipboard text to a local file to keep a backup. AI can export the same format with `launch.sh --settings-backup`; this command only reads local state. Backups contain local account IDs and are private, unlike the diagnostic report.

To restore, copy that JSON back to the clipboard and choose **Restore settings**. Parsing, size (8 KiB), version, field and value validation finish before the native `setShared` writes only `remaining.preferences`. Unknown fields or malformed backups are rejected without changing preferences. Accounts missing from this computer are skipped. Accounts added after the backup keep their current pause state and follow the restored order. If the saved theme is unavailable, keep the current installed appearance or fall back to Bars and show Restored · check with details on hover. Theme files and CLI logins must be installed separately.

The buttons do not overwrite the clipboard on restore or failed validation. Backup/restore is disabled during an in-progress diagnostic copy to avoid competing clipboard operations. Currently paused IDs that are temporarily absent are retained; a merge exceeding the supported 20 pause entries is rejected instead of silently dropping entries. Normal widget polling responds to restored monitoring/refresh changes; theme/order-only restores do not force provider queries. No direct edits to Herdr's shared.json are used.

## Implementation map

- `main.js`: native GPUI view, settings and the two renderers.
- `account-actions.mjs`: fixed official destinations and refresh-state presentation.
- `diagnose.mjs`: read-only offline checks and sanitized machine-readable reports.
- `diagnostic-report.mjs`: strict shareable-report whitelist used by Copy diagnostics.
- `local-state.mjs`: shared local profile/preference/cache compatibility checks.
- `recommend.mjs`: offline per-provider ranking and optional collection before AI account selection.
- `settings-format.mjs`: native-safe versioned settings backup validation and account-aware restoration.
- `settings-backup.mjs`: read-only JSON backup export for AI/shell use.
- Project `tools/releases.mjs`: checksum-packaged local builds, staged updates, protected themes/configuration and managed-code rollback. Read docs/maintenance.md in the source project before deployment.
- `theme-format.mjs`: schema contract, bounded validation, defaults and safe fallback to Bars.
- `theme-schema.json`: generated JSON Schema for AI authors/editors; `themes.mjs`: local catalog loader.
- `themes/`: selectable presets. Invalid files are reported in settings and ignored; built-ins remain available. A deleted selection falls back to Bars.
- `presentation.mjs`: remaining values and independent short/weekly selection.
- `usage.mjs`, `profiles.mjs`, `normalize.mjs`: provider collection, login discovery, identity isolation and normalization.
- `rings/`: the Lucide circle track and generated percentage strokes, with licenses under `icons/`. Rebuild in the source project with `node tools/build-theme-assets.mjs` after schema or stroke changes.

Theme files are limited to 16 KiB each, at most 50 JSON files. Symlinks are ignored. Native UI uses inherited app fonts and theme tokens; no browser, extra network service or new dependency is needed.

Never publish local accounts, credentials, usage snapshots or screenshots containing real identities/terminal content. Publication is currently on hold.
