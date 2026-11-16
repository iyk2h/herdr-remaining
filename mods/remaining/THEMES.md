# Themes and display rules

## Add a theme

Replace `<installed-mod-folder>` with its absolute path.

1. Read `theme-schema.json`.
2. Examine a file in `themes/` and `examples/compact.json`.
3. Add `themes/<id>.json` with a unique lowercase ID that matches the filename.
4. Set `$schema` to `../theme-schema.json`.
5. Supply `id`, `name`, and `layout`.
6. Validate the theme files:

   ```sh
   /bin/sh "<installed-mod-folder>/launch.sh" --themes --check
   ```

7. Select the new theme under **Appearance** in Settings.
8. Do the native check with `herdr-app check "<installed-mod-folder>"`.
9. Examine the widget in Herdr.

Theme validation reads local files only. Errors identify the file and field.
Herdr reloads the theme list after a folder change.
An added theme does not select itself or query providers.
An invalid theme does not replace the built-in themes.
A missing selected theme uses Bars.

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

The `layout` value selects `bars` or `rings`.
The optional `show`, `sizes`, and `colors` fields adjust the existing renderers.
The schema supplies defaults for absent fields.
JSON themes do not execute commands or import code.
A new arrangement requires a renderer change and a schema extension.

The loader reads the first 50 JSON files in filename order.
Each file has a 16 KiB limit.
The loader ignores symbolic links.
Colors accept `profile`, `#RRGGBB`, or the semantic tokens in the schema.
Semantic tokens adapt to the app theme. Explicit colors stay fixed.

## Keep the shared geometry

Both built-in styles use the same header, name width, limit columns, and row centers.
Default rows are 32px. Three rows fit a 132px sidebar block.
Additional accounts or larger theme sizes can require a scrollbar.
At widths less than 160px, the widget shows badges and a percentage.

The reset countdown uses `colors.text`, like the account name.
Its font is 10px with 11px line height and a 1px gap below the name.
A 9px clock precedes the countdown with a 3px gap.
The single-window form is `3d 12h`.
The dual-window form is `5h 1h 20m · 7d 3d 12h`.
Exact local reset times appear on hover.

The shared `rowMetrics` reserves at least 2px between the text area and the bar.
Both styles use its `bottom` padding.
The bar occupies the reserved space without a change to row height.

Preserve these positions during renderer changes.
Do not move reset times under separate percentage columns.
Do not change account settings during theme changes.
Theme changes must not invalidate `pollingPreferences`.

## Preserve the limit data

`windows[].used` contains provider-reported consumption.
The display converts this value once with `100 - used`.
Display values stay between 0% and 100%.
A positive fraction less than one percent appears as `<1%`.

The `5h` column uses a general 300-minute window.
The `7d` column uses a general 10080-minute window.
The `quotaColumns` function hides columns that no monitored account reports.
Mixed account lists keep empty slots for alignment.
Provider-specific model or review limits do not become general account limits.

Some accounts report only weekly limits. The provider response determines the available windows.
A plan name alone does not prove that a limit exists.
Missing values remain unknown. A reported short window takes precedence over plan assumptions.
Local token totals cannot supply a missing allowance percentage.

The bar always represents the weekly window.
It does not change to the smallest allowance or combine windows.
Failed queries stay distinct from exhausted limits.
Saved values require the existing identity checks.

An unknown reset timestamp adds no countdown.
An elapsed timestamp shows `Reset pending` until the provider reports new data.
The passage of a reset time does not prove a renewed allowance.
