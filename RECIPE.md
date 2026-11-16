# Remaining

A native Herdr sidebar for existing Claude and Codex subscription accounts.
The [README](README.md) contains the preview and installation procedure.

## What you see

Account rows show remaining limits and reset countdowns.
Bars and Rings share the same geometry.
[Themes](mods/remaining/THEMES.md) defines the display and data rules.

## How it behaves

The widget reads supported local CLI accounts and refreshes their limits.
Settings control account pauses, order, appearance, and refresh interval.
[AI commands](mods/remaining/AI.md) provide diagnostics, recommendations, and settings backups.

## Built from

The native view uses `gpui-kit` elements and `gpui-base` controls.
Herdr supplies theme colors, shared state, commands, overlays, timers, and folder watchers.
Separate Node modules handle provider access and local data.
JSON files define themes through a bounded schema.
The [maintenance guide](docs/maintenance.md) describes development and release packages.

## Watch out

Provider data can omit a limit window or model scope.
An omitted limit remains unknown.
Account recommendations compare percentages, not absolute task capacity.
[Account settings](mods/remaining/ACCOUNTS.md) describes credentials and private local files.

## Done when

1. Do the Node tests and native checks from the maintenance guide.
2. Examine both styles with single-window and mixed-window example accounts.
3. Examine narrow widths, reset states, refresh errors, and settings actions.
4. Make sure that identity changes clear saved account values.
5. Make sure that invalid clipboard data leaves settings unchanged.
6. Make sure that failed updates preserve user files.
7. Examine the repository preview for real account information before publication.
