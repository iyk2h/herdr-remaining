# AI commands

Read the host file `~/.config/herdr-app/AGENTS.md` before changes to the installation.
[Account settings](ACCOUNTS.md) describes discovery and credential access.
[Themes](THEMES.md) describes JSON themes and display constraints.

## Diagnose the installation

1. Start the offline diagnostic:

   ```sh
   /bin/sh <installed-mod-folder>/launch.sh --diagnose
   ```

2. Examine the report codes and suggested actions.

The report covers discovery, executable availability, saved query results, cache age, preferences, and theme validity.
Paused accounts do not contribute active query errors.
Exit codes are `0` for healthy, `1` for warnings, and `2` for errors.

The diagnostic makes no provider request and reads no credential contents.
It does not access Keychain, change state, or prove that a login remains valid.
It omits account names, emails, IDs, paths, tokens, raw errors, and limit percentages.
Theme errors use counts. The theme validation command gives local filenames and fields.

**Copy diagnostics** applies an additional field allowlist before the clipboard write.
Valid warning and error reports also copy.
Invalid output leaves the clipboard unchanged.
The button sends no report to another service.

For a new provider query:

1. Start `launch.sh --refresh` locally.
2. Do the diagnostic again.

The refresh output contains a private account snapshot.
Do not publish that output.

## Recommend an account

1. Start the recommendation command:

   ```sh
   /bin/sh <installed-mod-folder>/launch.sh --recommend --provider codex
   ```

2. Examine `recommendedId` in each provider group.
3. If the ID is non-null, resolve it against the local account or registered agent.

The command accepts `codex` or `claude`.
Without `--provider`, it returns separate groups for all providers.
The default command reads local settings and the saved cache only.
It does not access credentials, query providers, change logins, or start agents.
The output contains private local account IDs and limit values.
It omits names, emails, credentials, home paths, and launch commands.

Exit code `0` means at least one requested group has a recommendation.
Exit code `1` means no account qualifies.
Exit code `2` means a settings, runtime, or argument error.

The ranking uses these values, in order:

1. The largest minimum remaining percentage across reported general limits.
2. The earliest future reset of that minimum limit.
3. The saved account order.

A missing `5h` window does not exclude an account.
An exhausted `5h` window excludes an account even with weekly capacity.
Scoped limits do not affect the general recommendation.
Different plans can have different absolute allowances.
This ranking does not predict task capacity or model access.

Accounts do not qualify in these states:

- A monitoring pause or explicit usage block.
- A failed query, incompatible cache source, or invalid general limit.
- A future fetch timestamp or a sample at least one selected refresh interval old.
- An elapsed reset timestamp.

### Request fresh data

Add `--refresh` to the recommendation command:

```sh
launch.sh --recommend --provider codex --refresh
```

This command queries all monitored accounts through the existing collector, including other providers.
It uses saved preferences, the collector lock, and the 10-second manual refresh throttle.
It waits up to 90 seconds for a pending collector.
A failed, timed-out, or pending refresh returns no recommendation from old data.
After completion, the command reads settings and cache again.
Freshness uses the time after the refresh.

The report uses `mode: refresh` and a `refresh` value of `completed` or `skipped`.
A requested provider without monitored accounts skips collection.
Completion does not prove that every account query succeeded.
Each provider group includes account states and `refreshRequired`.

### Select a model scope

Add `--model opus` or an exact reported model ID or display name.
Matching ignores letter case and normalizes whitespace.
Matching does not use substrings.
Claude active model scopes retain IDs and names.
Legacy Sonnet and Opus windows retain their family labels.

The selected model limit combines with general limits.
Either limit can exclude the account.
Other model limits do not affect this selection.
Opaque Codex bucket IDs and labels do not identify a model.

Without a matching reported window, an account has `modelCoverage: not_reported` and no model recommendation.
If missing model data is the only obstacle, the report uses `model_limits_unavailable`.
This state means unknown model capacity. It does not prove that the model cannot operate.
Cache schema 3 requires a fresh read after an update from older model metadata.

## Back up and restore settings

1. Select **Copy settings**.
2. Save the clipboard JSON in a local file.

AI assistants can export the same format with `launch.sh --settings-backup`.
This command reads local state only.
The backup contains account IDs, display order, pauses, theme ID, and refresh interval.
It excludes credentials, emails, directories, snapshots, theme files, and unrelated Herdr settings.
The backup remains private because it contains local IDs.

To restore a backup:

1. Copy the saved JSON to the clipboard.
2. Select **Restore settings**.
3. If the button shows **Restored · check**, examine its tooltip.

Restore validates the size, version, fields, and values before it writes only `remaining.preferences`.
The size limit is 8 KiB.
Invalid input leaves settings unchanged.
Missing accounts are skipped.
New accounts keep their pause state and follow the restored order.
Temporarily absent paused accounts remain paused.
A merge with more than 20 pause entries fails without changes.

If the saved theme is absent, restore retains the current theme or uses Bars.
Restore does not install theme files or CLI logins.
It does not change the clipboard.
The buttons wait during a diagnostic copy.
Only changes to monitoring or refresh preferences trigger a provider query.
