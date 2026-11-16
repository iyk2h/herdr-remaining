# Maintenance

## Development

The project has no npm dependencies.
The native view uses GPUI. Node modules collect and normalize provider data.
The view must not import Node APIs.

For runtime changes:

1. Do the Node tests with `npm test`.
2. Do the native checks with `npm run check:native`.
3. For UI changes, examine a real Herdr frame.

The native helper covers 25 example states under `.local/native`.
The `--case <name>` argument selects one state.
Native checks cannot prove layout, paint, or later interactions.

For a repository preview:

1. Make sure that no unrelated popup is open.
2. Start `npm run preview`.
3. Examine `preview.png` before publication.

The preview helper uses example accounts and closes its own popup.
The full-window image stays under ignored `.local/`.
Real account screenshots must stay outside Git and release packages.

## Build a release

1. Build the package with `npm run build:release`.
2. Keep the reported `dist/<version>-<content-hash>/` folder intact.

The package contains distribution files and a checksum manifest.
The build rejects credentials and local `accounts.json` files.
Generated native types are absent from the package.
Packages require ordinary files and directories. Symbolic links are not supported.

## Existing installations

An existing legacy Remaining installation requires an exact baseline package.
Adoption requires the Remaining ownership marker and matching managed files.
It records the baseline without changes to the installed files.
The installer refuses a folder that belongs to another mod.

1. Adopt the existing baseline:

   ```sh
   node tools/releases.mjs adopt --release /absolute/path/to/baseline-release
   ```

2. Install the new package:

   ```sh
   node tools/releases.mjs install --release /absolute/path/to/new-release
   ```

For a new installation, use the [README procedure](../README.md#install).

## Update

1. Examine the installed state with `node tools/releases.mjs status`.
2. Preserve intended code edits in the source project.
3. Build a new package.
4. Install that package with `node tools/releases.mjs install --release /absolute/path/to/release`.

The `--app-home /absolute/path` argument selects another Herdr home.
The default uses `HERDR_APP_HOME` or `~/.config/herdr-app`.
Status reports the current release, rollback targets, and changed managed code.

Updates replace managed code, documentation, icons, and ring assets only after matching the previous checksums.
Edited managed files and collisions with unowned files stop the update.
Existing theme files remain user-owned, including customized built-ins.
The installer adds missing packaged themes.
Account files, preferences, layouts, CLI logins, caches, and other unowned files remain intact.

The installer prepares a separate folder and validates its checksums.
It does the native check, then validates checksums again.
An edit to the original installation during validation stops replacement.
A process lock prevents simultaneous updates.
A journal records the directory replacement.
The window can briefly reload because replacement requires two directory renames.

Managed snapshots stay in `$HERDR_APP_HOME/data/remaining/deploy/releases/`.
Snapshots contain distribution files only.
They do not contain local account settings or custom themes.
Do not edit snapshots or deployment metadata manually.

## Rollback and recovery

1. Examine the rollback targets with `node tools/releases.mjs status`.
2. Restore the previous release with `npm run release:rollback`.

For a specific target, use `node tools/releases.mjs rollback --to <release-id>`.
Rollback uses the same validation and edit protection as updates.
It preserves current themes, settings, and account files.
A custom theme for a newer renderer can require adjustment after rollback.
Installation of the current release makes no changes.

After an interrupted replacement, the next mutating command attempts recovery from the journal.
A failed replacement folder stays under a private `.remaining-recovered-*` sibling.
This retention protects possible user edits.

Cache schema changes can trigger a fresh provider query after update or rollback.
Rollback does not restore old limit percentages or change logins.
The source project retains its current version.
