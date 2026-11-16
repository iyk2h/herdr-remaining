# Remaining

A compact native Herdr sidebar for Claude and Codex subscription limits. It reuses existing CLI accounts, shows remaining percentages and reset countdowns, and gives AI assistants bounded themes, diagnostics and account-selection commands.

![Remaining](preview.png)

## What you see

The default Bars appearance has a Remaining header, last-update age, refresh and settings controls. Each account has a small colored badge, its configured name, a bright reset countdown with a clock, aligned quota percentages and a thin weekly-remaining track. Rings is an optional rendering of the same quotas. Both styles share name widths and 32px default rows. Three common rows fit a 132px sidebar block; additional rows scroll.

Only quota columns reported by a monitored account appear. The short window is 300 minutes (5h), the weekly window 10080 minutes (7d). Mixed lists retain empty slots for alignment. A missing limit is never represented as zero or unlimited. One countdown reads like 3d 12h; two windows identify their respective reset durations with 5h/7d labels. Exact local reset times are on hover.

## How it behaves

- Discover direct Claude/Codex launch definitions in Herdr programs.json and existing default CLI logins. Deduplicate by provider and home directory. Do not execute launcher wrappers during discovery.
- Poll five minutes after the oldest successful account fetch by default. Settings allow 1, 5, 10 or 15 minutes. Failed accounts retry after a minute; preserve old values only under verified identity rules. Keep their age and show stale/retry feedback.
- Refresh spins natively during collection. Manual refreshes are throttled to ten seconds and share a collector lock. No animation redraw timer and no quota alerts.
- Right-click an account to open the provider's fixed official usage page. Explain that the browser's signed-in account can differ from the CLI account.
- Settings controls monitoring pauses, arrow-based order, appearance and interval. No sidebar drag-and-drop. Copy diagnostics emits a strict privacy-filtered report; Copy settings and Restore settings use validated versioned clipboard JSON.
- Missing reset timestamps add no fake countdown. A passed reset says Reset pending until the provider updates it. Exhausted remaining percentages are explicit zero; a real positive fraction under one percent remains <1%.

## Built from

Use a personal sidebar block with content.mod remaining, size.px 132 and min 112. Clone a shipped layout before changing its structure. The mod uses gpui-kit View/div/svg and gpui-base layout/native buttons, Herdr shared state, exec, overlays, timers, folder watching and the user's theme tokens. The application has no webview or npm runtime dependencies.

Native code lives in main.js. Pure modules handle display formatting, preferences, clipboard report filtering and backup restoration. Node-only modules handle existing profile discovery, identity-checked provider collection, normalization, caching, theme loading, diagnostics, backup export and recommendations. Node modules must not be imported into the native view.

Claude collection reads existing CLI metadata and credentials or the configured macOS Keychain service and calls its OAuth usage endpoint. Codex collection starts its own no-daemon app-server and sends only initialize/account/rate-limit RPCs, then terminates that child. Never start a model turn, copy credentials into this mod or print raw authentication data.

JSON themes live in themes/<id>.json and follow theme-schema.json: a bars/rings primitive, selected display fields, bounded sizes and semantic or explicit colors. Invalid files are reported and ignored; safe built-ins remain. Reload the local theme catalog without querying providers.

AI commands include --diagnose, --settings-backup and --recommend with optional --provider, --refresh and --model. Default recommendations use local cache only. Model-specific selection requires exact explicit scope metadata, not guesses from generic billing bucket names. Use the existing collector for explicitly requested fresh recommendations.

Local release tooling creates checksum packages, stages updates with a native check, preserves themes/configuration, detects local code edits and offers rollback of managed code. Keep the toolchain separate from the runtime mod. Read docs/maintenance.md for state and recovery behavior.

## Watch out

Tested on macOS. Linux credential-file paths exist but have not been live-tested. The shell launcher does not support Windows. Node.js 18+ and existing supported CLI logins are required. Remote-machine accounts are outside discovery scope. The Claude usage endpoint is undocumented and can change.

Some plans report only weekly limits. Model-specific capacity may not be reported; absence does not prove unlimited usage or model access. Recommendation is a relative percentage heuristic, not a guarantee of task capacity. Retain account identity/source checks and do not rank provider-scoped review quotas as general account quotas.

The display consumes provider-reported consumption and converts it to remaining once. A Bars track always shows weekly remaining. Do not switch its meaning to whichever quota is lowest.

Keep local account configuration, credentials, usage caches, real screenshots and private development artifacts out of Git and packages. The public preview must use synthetic data only. Preserve other mods, keys, layouts and unrelated shared state during installation and updates.

## Done when

The Node suite passes for discovery, identity isolation, formatting, quotas, refresh scheduling, settings/clipboard behavior, recommendation eligibility, model matching and update/rollback transactions. Native checks pass for both styles, single/mixed windows, narrow widths, missing/pending resets, failure states and settings actions. Inspect real frames for spacing, readable countdowns, missing-limit alignment and settings clipping.

Verify provider reads only through existing account endpoints, without a model turn or login change. Verify default diagnostics/recommendations remain offline, private data is absent from copied diagnostics, backups round-trip only Remaining preferences, and interrupted/failed updates preserve user data. Use a synthetic image for preview.png.
