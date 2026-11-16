# Remaining

Read README.md, docs/maintenance.md and the host's ~/.config/herdr-app/AGENTS.md before changing the installation. This is a native Herdr GPUI mod; Walla application conventions and dependencies do not apply here.

- Keep the sidebar small. Preserve the current account name + clock/countdown arrangement, primary text color for reset time, shared Bars/Rings row geometry and conditional quota columns. The user rejected placing each reset under its quota column.
- Runtime code lives in mods/remaining; Node-only collectors/CLI modules must not be imported by the native view. JSON themes are bounded, declarative data.
- Preserve provider identity checks and distinguish missing limits, zero remaining, failed queries and elapsed resets. Model selection requires an exact model identifier/display-name match from explicit scope metadata; never infer a model from an opaque bucket ID.
- Run npm test and npm run check:native for changed runtime behavior. The latter writes synthetic fixtures under .local/native and does not change the user's clipboard. A passing native check does not prove paint or later interactions; inspect a real frame for UI changes.
- Deploy through tools/releases.mjs after building a checked release. Do not use the old temporary installer to overwrite managed code. Updates refuse modified code and preserve themes/configuration; move intended code customizations back into this project first.
- Keep credentials, local accounts.json, usage snapshots, real screenshots and deployment state out of Git and release packages. .local and dist are untracked. Release snapshots contain distribution files only.
- This project remains private and local. Do not create a remote repository, push, publish or submit to a gallery without the user's new explicit instruction. The intended eventual personal owner is iyk2h.
- Quota alerts remain deferred. Do not add notifications or restore sidebar drag-and-drop.
