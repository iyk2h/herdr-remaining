# Local releases and rollback

This project is private. No Git remote, publication or gallery submission is configured. The running app keeps its layout, shared preferences, account configuration and quota cache outside the source project.

## Build and inspect

Run `npm test`, then `npm run check:native` for runtime changes. Build with `npm run build:release`. The result is `dist/<version>-<content-hash>/`, containing a checksum manifest and distribution files only. Keep this folder intact. Credentials and local accounts.json are refused; generated native types are excluded. Packages and payloads must be ordinary files/directories, without symbolic links.

`node tools/releases.mjs status` reports the installed release, older rollback targets and whether managed code was edited. `--app-home /absolute/path` selects another Herdr home for every installation operation.

## Initial install or migration

For an empty target, use `node tools/releases.mjs install --release /absolute/path/to/release`. It installs the mod but does not add or replace a layout. Follow README.md to place it in a personal sidebar.

An existing legacy Remaining installation must first be adopted with its exact baseline package:

```
node tools/releases.mjs adopt --release /absolute/path/to/baseline-release
node tools/releases.mjs install --release /absolute/path/to/new-release
```

Adoption requires the local Remaining ownership marker and an exact match for managed code/assets. A folder belonging to another mod is refused. Adoption records the existing version without rewriting its files.

## Updates

Install a new package using the same install command. Managed JavaScript, shell helpers, icons, documentation and generated ring assets are replaced only if the current managed files still match the previous release. Directly edited code or a new package path colliding with an unowned file blocks the update; preserve those edits in the source project and build a new release.

All existing `themes/` files, including customized built-ins, remain user-owned and are preserved. Missing packaged themes are seeded. Local accounts.json, other unowned mod files, shared preferences, data, CLI logins and layouts are preserved. A custom theme requiring a newer renderer may need adjustment after a rollback; it is never silently overwritten.

The tool stages the full mod, checks hashes, runs Herdr's native checker, checks hashes again and refuses a swap if the original installation changed during validation. A process lock prevents concurrent release operations. A journal allows the next mutating operation to recover an interrupted directory swap. Failed post-swap folders are retained under a private `.remaining-recovered-*` sibling instead of discarding potential edits. The window can briefly reload during the directory replacement; it is not a single atomic filesystem swap.

Managed release snapshots are stored in `$HERDR_APP_HOME/data/remaining/deploy/releases/`; they contain distribution files, never copied account configuration or the user's custom themes. Do not manually alter snapshots or deployment metadata.

## Rollback

`npm run release:rollback` restores the previous managed release. To choose one, use `node tools/releases.mjs rollback --to <release-id>` from the status output. Current user themes, settings and account files are carried forward. Rollback also refuses modified managed code, verifies the package and runs the native check before replacing files. Reinstalling the current release is an idempotent no-op.

Cache schema changes can require a fresh account read after update or rollback. This does not change CLI logins or restore old quota percentages. The current development source remains at the latest version after a runtime rollback.
