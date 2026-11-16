# Contributor instructions

Before changes to the installation:

1. Read `README.md` and `docs/maintenance.md`.
2. Read the host file `~/.config/herdr-app/AGENTS.md`.

For code changes:

- Keep runtime code inside `mods/remaining`.
- Keep Node APIs outside the native view.
- Preserve the display and data rules in `mods/remaining/THEMES.md`.
- Keep identity checks separate from theme changes.
- Require explicit model scope metadata for model recommendations.
- Do the tests and native checks from the maintenance guide.
- For UI changes, examine a real Herdr frame.
- Deploy with `tools/releases.mjs`.
- Preserve local edits in the source project before an update.
- Keep account files, credentials, caches, real screenshots, and deployment state outside Git.
- Keep limit notifications and sidebar drag-and-drop absent unless the user requests them.
- Register the project in a gallery only after an explicit user request.

For documentation changes:

- Write English with short sentences, active voice, and consistent terms.
- Keep installation in README, account access in ACCOUNTS, themes in THEMES, and AI commands in AI.
- Keep release procedures in the maintenance guide.
- Link to the relevant guide instead of repeating its procedure.
- Preserve command names, identifiers, and quoted UI labels.
