import { View, div, svg } from 'gpui-kit';
import { h_flex, v_flex, Button } from 'gpui-base';
import { appHome, exec, theme, nextCommand, shared, setShared, props, openOverlay, closeOverlay, watchFolder } from 'herdr';
import { nextRefreshAt, RETRY_MS } from './refresh-policy.mjs';
import { remaining, amount, quotaTone, quotaPair, quotaColumns, quotaDescription, rowMetrics, resetLabel, resetSummary, shortAge, oldestFetch } from './presentation.mjs';
import { preferences, pollingPreferences, INTERVALS, orderedAccounts, moveAccount } from './preferences.mjs';
import { DEFAULT_THEMES, activeTheme } from './theme-format.mjs';
import { usagePage, refreshFeedback, refreshResult } from './account-actions.mjs';
import { diagnosticsClipboard } from './diagnostic-report.mjs';
import { createSettingsBackup, restoreSettingsBackup } from './settings-format.mjs';

const MOD = 'remaining';
const PREFS = `${MOD}.preferences`;
const SNAPSHOT = `${MOD}.snapshot`;
const CATALOG = `${MOD}.themes`;
const SETTINGS_HEIGHT = 430;
const updated = (at) => Number.isFinite(at) ? `Updated ${shortAge(at) === 'now' ? 'just now' : shortAge(at)}` : 'Not updated yet';

export default class Remaining extends View {
  init(_props, cx) {
    this.accountMenu = props()?.accountMenu ?? null;
    if (this.accountMenu) { this.menuFocus = cx.focus_handle(); this.menuFocus.focus(); return; }
    this.settings = Boolean(props()?.settings);
    this.width = 268;
    this.data = null;
    this.busy = false;
    this.error = null;
    this.refreshTimer = null;
    this.copyState = 'idle';
    this.backupState = 'idle';
    this.restoreState = 'idle';
    if (this.settings) { cx.timer.every(60000, (cx) => cx.notify()); return; }
    cx.spawn(async (cx) => {
      await this.loadThemes(cx);
      for (;;) {
        try { await watchFolder(`${appHome()}/mods/${MOD}/themes`); await this.loadThemes(cx); }
        catch { await cx.sleep(5000); }
      }
    });
    this.preferenceKey = JSON.stringify(pollingPreferences(shared(PREFS)));
    this.refresh(cx);
    cx.timer.every(1000, (cx) => {
      const key = JSON.stringify(pollingPreferences(shared(PREFS)));
      if (key !== this.preferenceKey && !this.busy) { this.preferenceKey = key; this.refresh(cx); }
    });
    cx.timer.every(60000, (cx) => cx.notify());
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === 'refresh') this.refresh(cx, true);
        if (command === 'settings') this.openSettings();
        if (command === 'bars' || command === 'rings') setShared(PREFS, { ...preferences(shared(PREFS)), theme: command });
      }
    });
  }

  async loadThemes(cx) {
    try {
      const result = await exec('/bin/sh', [`${appHome()}/mods/${MOD}/launch.sh`, '--themes'], { timeout: 10000 });
      const catalog = JSON.parse(result.stdout);
      if (Array.isArray(catalog.themes) && catalog.themes.length) setShared(CATALOG, catalog);
    } catch { setShared(CATALOG, { themes: DEFAULT_THEMES, errors: ['Unable to load theme files'] }); }
    cx.notify();
  }

  appearance() { return activeTheme(shared(CATALOG), preferences(shared(PREFS)).theme); }

  ink(token, profile) {
    return token === 'profile' ? theme()[profile?.tint] ?? theme().muted : token.startsWith('#') ? token : theme()[token] ?? theme().muted;
  }

  quotaColor(window, token, profile) {
    const appearance = this.appearance();
    const status = quotaTone(window);
    return this.ink(status === 'blocked' ? appearance.colors.exhausted : status === 'working' ? appearance.colors.warning : token, profile);
  }

  openSettings() {
    const anchor = this.settingsAnchor ?? { x: 360, y: 400 };
    openOverlay({ mod: MOD, props: { settings: true }, kind: 'popup', width: 360, height: SETTINGS_HEIGHT,
      at: { x: Math.max(8, anchor.x - 348), y: Math.max(8, anchor.y - SETTINGS_HEIGHT - 8) } });
  }

  openAccountMenu(accountId, at) {
    openOverlay({ mod: MOD, props: { accountMenu: accountId }, kind: 'popup', width: 252, height: 108, at });
  }

  renderAccountMenu() {
    const t = theme();
    const account = shared(SNAPSHOT)?.accounts?.find((row) => row.id === this.accountMenu);
    const url = usagePage(account?.provider);
    const open = (cx) => { if (url) { closeOverlay(props().overlay); cx.open_url(url); } };
    return v_flex().w_full().h(108).p(6).gap(4).bg(t.popover).text_color(t.foreground)
      .track_focus(this.menuFocus).role('menu')
      .on_key_down((event, cx) => {
        if (event.key === 'Escape') closeOverlay(props().overlay);
        if (event.key === 'Enter') open(cx);
      })
      .child(div().px(8).h(22).text_size(11).line_height('14px').text_color(t.muted).truncate().child(account?.label || 'Account unavailable'))
      .child(div().id('remaining-open-usage').h(30).px(8).rounded(5).text_size(12).line_height('14px')
        .role('menu_item').accessibility_label('Open official usage in your browser')
        .when(Boolean(url), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_event, cx) => open(cx)))
        .when(!url, (e) => e.text_color(t.dim))
        .flex().items_center().child(url ? 'Open official usage' : 'Provider unavailable · refresh first'))
      .child(div().px(8).pt(4).text_size(10).line_height('12px').text_color(t.dim).child('Uses the account signed in to your browser.'));
  }

  armRefresh(cx) {
    this.refreshTimer?.cancel();
    const due = this.data?.pending ? Date.now() + 2000 : this.error ? Date.now() + RETRY_MS : nextRefreshAt(this.data);
    this.refreshTimer = cx.timer.after(Math.max(1000, due - Date.now()), (cx) => {
      this.refreshTimer = null;
      if (this.data?.pending || this.error || Date.now() >= nextRefreshAt(this.data)) this.refresh(cx);
      else this.armRefresh(cx);
    });
  }

  refresh(cx, force = false) {
    if (this.busy) return;
    this.refreshTimer?.cancel();
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await exec('/bin/sh', [`${appHome()}/mods/${MOD}/launch.sh`, '--preferences', this.preferenceKey, ...(force ? ['--refresh'] : [])], { timeout: 85000 });
        const next = JSON.parse(result.stdout);
        const accepted = refreshResult(this.data, next);
        this.data = accepted.data;
        this.error = accepted.error;
      } catch { this.error = 'Refresh failed; check Node.js, CLI login and accounts.json'; }
      setShared(SNAPSHOT, { ...this.data, error: this.error });
      this.busy = false;
      this.armRefresh(cx);
      cx.notify();
    });
  }

  iconButton(id, name, label, click, { spinning = false, warning = false } = {}) {
    const t = theme();
    return div().id(id).size(20).flex_none().rounded(5).text_color(warning ? t.working : t.dim).cursor_pointer().tooltip(label).accessibility_label(label)
      .flex().items_center().justify_center().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(click).child(svg(`mods/${MOD}/icons/${name}.svg`).size(12).flex_none().when(spinning, (e) => e.spin(900)));
  }

  copyDiagnostics(cx) {
    if (this.copyState === 'working') return;
    this.copyState = 'working';
    this.backupState = 'idle';
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await exec('/bin/sh', [`${appHome()}/mods/${MOD}/launch.sh`, '--diagnose'], { timeout: 15000 });
        cx.write_to_clipboard(diagnosticsClipboard(JSON.parse(result.stdout)));
        this.copyState = 'copied';
      } catch { this.copyState = 'failed'; }
      cx.notify();
    });
  }

  copySettings(cx) {
    if (this.copyState === 'working') return;
    try {
      cx.write_to_clipboard(createSettingsBackup(shared(PREFS), shared(SNAPSHOT)?.profiles ?? []));
      this.backupState = 'copied';
      this.copyState = 'idle';
    } catch { this.backupState = 'failed'; }
    cx.notify();
  }

  restoreSettings(cx) {
    if (this.copyState === 'working') return;
    try {
      const result = restoreSettingsBackup(cx.read_from_clipboard(), { current: shared(PREFS), profiles: shared(SNAPSHOT)?.profiles ?? [],
        themeIds: (shared(CATALOG)?.themes ?? DEFAULT_THEMES).map((appearance) => appearance.id) });
      setShared(PREFS, result.preferences);
      this.backupState = 'idle';
      this.restoreState = result.themeMissing || result.ignoredAccounts ? 'warning' : 'restored';
      this.restoreMessage = `Settings restored.${result.ignoredAccounts ? ` ${result.ignoredAccounts} saved account(s) not found.` : ''}${result.themeMissing ? ' Saved theme unavailable; kept an available appearance.' : ''}`;
    } catch { this.restoreState = 'failed'; this.restoreMessage = 'Invalid settings backup. Copy a Remaining settings backup and retry.'; }
    cx.notify();
  }

  switchTrack(enabled, tint) {
    const t = theme();
    return h_flex().w(26).h(15).p(2).rounded(8).flex_none().bg(enabled ? tint : t.border)
      .when(enabled, (e) => e.child(div().flex_1()))
      .child(div().size(11).rounded(6).bg(enabled ? t.chrome : t.dim))
      .when(!enabled, (e) => e.child(div().flex_1()));
  }

  renderSettings() {
    const t = theme();
    const prefs = preferences(shared(PREFS));
    const snapshot = shared(SNAPSHOT);
    const profiles = orderedAccounts(snapshot?.profiles ?? [], prefs.order);
    const accounts = snapshot?.accounts ?? [];
    const save = (patch) => setShared(PREFS, preferences({ ...prefs, ...patch }));
    const catalog = shared(CATALOG) ?? { themes: DEFAULT_THEMES, errors: [] };
    const root = v_flex().w_full().h(SETTINGS_HEIGHT).bg(t.popover).text_color(t.foreground).overflow_hidden();
    root.child(h_flex().px(18).pt(16).pb(10).gap(8).items_center()
      .child(v_flex().flex_1().gap(3)
        .child(div().text_size(14).font_semibold().child('Remaining'))
        .child(div().text_size(11).text_color(t.muted).child('Accounts & refresh')))
      .child(this.iconButton('remaining-close-settings', 'x', 'Close settings', () => closeOverlay(props().overlay))));
    root.child(div().mx(18).h(1).bg(t.border).flex_none());
    root.child(h_flex().px(18).pt(14).pb(7).items_center()
      .child(div().flex_1().text_size(10).font_semibold().text_color(t.muted).child('MONITORING'))
      .child(div().text_size(10).text_color(t.dim).child(`${profiles.filter((p) => !prefs.disabledIds.includes(p.id)).length} of ${profiles.length} active`)));
    root.child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(10)
      .children(profiles.map((profile, index) => {
        const enabled = !prefs.disabledIds.includes(profile.id);
        const account = accounts.find((a) => a.id === profile.id);
        const ok = account?.status === 'ok' && !snapshot?.error;
        const state = !enabled ? 'Paused' : snapshot?.error || account?.error || (ok ? updated(account.fetchedAt) : 'Checking connection…');
        const tint = t[profile.tint] ?? t.muted;
        const track = this.switchTrack(enabled, tint);
        const accountInfo = h_flex().id(`remaining-toggle-${profile.id}`).flex_1().min_w(0).gap(10).items_center().rounded(7)
          .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip([profile.label, account?.email, state].filter(Boolean).join('\n'))
          .accessibility_label(`${enabled ? 'Pause' : 'Monitor'} ${profile.label}`)
          .on_click(() => save({ disabledIds: enabled ? [...prefs.disabledIds, profile.id] : prefs.disabledIds.filter((id) => id !== profile.id) }))
          .child(div().size(26).rounded(7).bg(t.raised).flex_none().flex().items_center().justify_center().text_size(12).font_semibold().text_color(tint).child(profile.badge))
          .child(v_flex().flex_1().min_w(0).gap(3)
            .child(h_flex().gap(6).items_center()
              .child(div().truncate().text_size(12).line_height('14px').font_semibold().text_color(enabled ? t.foreground : t.muted).child(profile.label))
              .child(div().size(4).rounded(2).flex_none().bg(!enabled ? t.dim : ok ? t.ansi2 : t.working)))
            .child(div().text_size(10).line_height('12px').text_color(enabled && account?.error ? t.working : t.dim).truncate().child(enabled && ok ? account?.email || state : state)))
          .child(track);
        const step = (direction, available) => this.iconButton(`remaining-${direction}-${profile.id}`, direction, `Move ${profile.label} ${direction}`, (_e, cx) => {
          cx.stop_propagation();
          if (available) save({ order: moveAccount(profiles, prefs.order, profile.id, direction === 'up' ? -1 : 1) });
        }).size(16).when(!available, (e) => e.opacity(0.25));
        return h_flex().px(8).py(6).gap(8).items_center()
          .child(accountInfo)
          .child(v_flex().flex_none().gap(0).child(step('up', index > 0)).child(step('down', index < profiles.length - 1)));
      }))
      .when(!profiles.length, (e) => e.child(div().px(8).py(10).text_size(11).text_color(t.dim).child('Ask your AI to configure CLI accounts.'))));
    root.child(div().mx(18).h(1).bg(t.border).flex_none());
    root.child(v_flex().px(18).pt(12).pb(10).gap(7)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(11).font_semibold().child('Appearance'))
        .child(div().text_size(10).text_color(catalog.errors?.length ? t.working : t.dim)
          .tooltip(catalog.errors?.length ? catalog.errors.join('\n') : 'Add a theme JSON file in mods/remaining/themes · see AI.md')
          .child(catalog.errors?.length ? 'Check theme files' : 'AI themes')))
      .child(h_flex().max_h(62).overflow_y_scrollbar().flex_wrap().gap(5)
        .children(catalog.themes.map((preset) => div().id(`remaining-theme-${preset.id}`).w(157).h(26).rounded(6)
          .bg(prefs.theme === preset.id ? t.hover : t.raised).border_1().border_color(prefs.theme === preset.id ? t.muted : t.border)
          .text_color(prefs.theme === preset.id ? t.foreground : t.dim).text_size(11).font_semibold()
          .accessibility_label(`${preset.name} appearance${prefs.theme === preset.id ? ', selected' : ''}`)
          .cursor_pointer().flex().items_center().justify_center().hover((s) => s.text_color(t.foreground))
          .on_click(() => save({ theme: preset.id })).child(preset.name)))));
    root.child(v_flex().px(18).pt(13).pb(12).gap(8)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(11).font_semibold().child('Refresh every'))
        .child(div().text_size(10).text_color(t.dim).child('Applies automatically')))
      .child(h_flex().gap(5).children(INTERVALS.map((minutes) => div().id(`remaining-interval-${minutes}`).flex_1().h(26).rounded(6)
        .bg(prefs.refreshMinutes === minutes ? t.hover : t.raised).border_1().border_color(prefs.refreshMinutes === minutes ? t.muted : t.border)
        .text_color(prefs.refreshMinutes === minutes ? t.foreground : t.dim).text_size(11).font_semibold()
        .accessibility_label(`Refresh every ${minutes} minutes${prefs.refreshMinutes === minutes ? ', selected' : ''}`)
        .flex().items_center().justify_center().cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click(() => save({ refreshMinutes: minutes })).child(`${minutes}m`)))));
    const settingsAction = (id, label, description, click) => Button.new(id).flex_1().min_w(0).h(26).px(6).rounded(6).bg(t.raised)
      .text_size(10).text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).accessibility_label(description).tooltip(description)
      .disabled(this.copyState === 'working')
      .on_click(click).child(label);
    root.child(h_flex().px(18).pb(14).gap(6).items_center()
      .child(settingsAction('remaining-copy-settings', this.backupState === 'copied' ? 'Copied' : this.backupState === 'failed' ? 'Copy failed' : 'Copy settings',
        'Copy appearance, account order, monitoring and refresh preferences. No credentials.', (_event, cx) => this.copySettings(cx)))
      .child(settingsAction('remaining-restore-settings', this.restoreState === 'restored' ? 'Restored' : this.restoreState === 'warning' ? 'Restored · check' : this.restoreState === 'failed' ? 'Restore failed' : 'Restore settings',
        this.restoreMessage || 'Restore a Remaining settings backup from the clipboard.', (_event, cx) => this.restoreSettings(cx))
        .when(this.restoreState === 'warning' || this.restoreState === 'failed', (e) => e.text_color(t.working)))
      .child(Button.new('remaining-copy-diagnostics').flex_1().min_w(0).h(26).px(6).rounded(6).bg(t.raised).text_size(10)
        .text_color(this.copyState === 'failed' ? t.working : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
        .disabled(this.copyState === 'working').accessibility_label('Copy diagnostics without account identities or credentials')
        .tooltip('Copy a diagnostic report without account identities or credentials.')
        .on_click((_event, cx) => this.copyDiagnostics(cx))
        .child(this.copyState === 'working' ? 'Checking…' : this.copyState === 'copied' ? 'Copied' : this.copyState === 'failed' ? 'Copy failed · retry' : 'Copy diagnostics')));
    return root;
  }

  bar(window, account) {
    const appearance = this.appearance();
    const left = (remaining(window) ?? 0) / 100;
    return h_flex().w_full().h(appearance.sizes.bar).flex_none().rounded(2).bg(this.ink(appearance.colors.track, account)).overflow_hidden()
      .accessibility_label(`Weekly limit: ${amount(window)} left`)
      .child(div().h_full().flex_basis(0).flex_grow(left).bg(this.quotaColor(window, appearance.colors.fill, account)))
      .child(div().h_full().flex_basis(0).flex_grow(1 - left));
  }

  readout(window, label, primary, account) {
    const appearance = this.appearance();
    const font = primary ? appearance.sizes.font : appearance.sizes.font - 1;
    return div().w(rowMetrics(appearance).column).flex_none().text_center()
      .tooltip(quotaDescription(window, label, Date.now(), this.error || account.error))
      .accessibility_label(`${label}: ${window ? `${amount(window)} left` : 'not available'}`)
      .text_size(font).line_height(`${font + 2}px`).font_semibold()
      .text_color(!window ? theme().dim : this.quotaColor(window, primary ? appearance.colors.text : appearance.colors.secondary, account)).child(amount(window));
  }

  ring(window, label, account) {
    const appearance = this.appearance();
    const size = appearance.sizes.ring;
    const left = remaining(window);
    const percent = left === null ? 0 : Math.max(1, Math.round(left));
    return div().relative().size(size).flex_none().accessibility_label(`${label}: ${amount(window)} left`)
      .tooltip(quotaDescription(window, label, Date.now(), this.error || account.error))
      .child(svg(`mods/${MOD}/rings/track.svg`).size(size).text_color(this.ink(left === 0 ? appearance.colors.exhausted : appearance.colors.track, account)))
      .when(left > 0, (e) => e.child(svg(`mods/${MOD}/rings/${percent}.svg`).absolute().left(0).top(0).size(size)
        .text_color(this.quotaColor(window, appearance.colors.fill, account))))
      .child(div().absolute().left(0).top(0).size(size).flex().items_center().justify_center()
        .text_size(Math.min(9, size / 2.7)).font_semibold()
        .text_color(!window ? theme().dim : this.quotaColor(window, appearance.colors.text, account)).child(amount(window)));
  }

  card(account, columns) {
    const t = theme();
    const appearance = this.appearance();
    const metrics = rowMetrics(appearance);
    const pair = quotaPair(account);
    const short = columns.short ? pair.short : null;
    const weekly = columns.weekly ? pair.weekly : null;
    const window = weekly ?? short;
    const reset = resetSummary({ short, weekly });
    const stale = this.error || account.status === 'stale';
    const problem = this.error || account.error;
    const badge = div().size(appearance.sizes.badge).flex_none().rounded(5).bg(t.raised).text_color(t[account.tint] ?? t.muted)
      .text_size(10).line_height('12px').font_semibold().flex().items_center().justify_center().child(account.badge);
    const tooltip = [account.label, account.email,
      usagePage(account.provider) ? 'Right-click to open official usage' : null,
      appearance.layout === 'bars' && weekly ? 'Bar · weekly remaining' : null,
      appearance.show.short && !short ? quotaDescription(null, '5h', Date.now(), problem) : null,
      appearance.show.weekly && !weekly ? quotaDescription(null, '7d', Date.now(), problem) : null,
      ...(account.windows ?? []).map((w) => `${w.label} · ${amount(w)} left · ${resetLabel(w.resetAt, Date.now(), true)}`),
      account.ordinaryUsageAllowed === false ? 'Limit reached · waiting for reset' : null,
      updated(account.fetchedAt), problem].filter(Boolean).join('\n');
    if (this.width < 160) {
      return h_flex().id(`remaining-${account.id}`).items_center().justify_center().py(4).gap(4).tooltip(tooltip)
        .on_mouse_down('right', (event, cx) => { cx.stop_propagation(); this.openAccountMenu(account.id, event.position); })
        .when(appearance.show.badge, (e) => e.child(badge))
        .child(div().text_size(11).text_color(stale ? t.dim : this.quotaColor(window, appearance.colors.text, account)).child(amount(window)));
    }
    const top = h_flex().size_full().items_center().gap(appearance.sizes.gap)
      .when(appearance.show.badge, (e) => e.child(badge))
      .child(v_flex().flex_1().min_w(0).justify_center().gap(1)
        .child(div().truncate().text_size(appearance.sizes.font).line_height(`${appearance.sizes.font + 1}px`)
          .font_semibold().text_color(this.ink(appearance.colors.text, account)).child(account.label))
        .when(Boolean(reset), (e) => e.child(h_flex().min_w(0).gap(3).items_center()
          .text_color(this.ink(appearance.colors.text, account)).tooltip('Time until limit reset')
          .child(svg(`mods/${MOD}/icons/clock.svg`).size(9).flex_none())
          .child(div().min_w(0).truncate().text_size(10).line_height('11px').child(reset)))))
      .when(Boolean(stale), (e) => e.child(div().text_size(9).text_color(t.working).child('Stale')));
    const slot = (value, label, primary) => div().w(metrics.column).flex_none().flex().items_center().justify_center()
      .when(Boolean(value) || Boolean(problem), (e) => e.child(appearance.layout === 'rings' ? this.ring(value, label, account) : this.readout(value, label, primary, account)));
    top.child(h_flex().flex_none().items_center().gap(appearance.sizes.gap)
      .when(columns.short, (e) => e.child(slot(short, '5h', !columns.weekly)))
      .when(columns.weekly, (e) => e.child(slot(weekly, '7d', true))));
    return v_flex().id(`remaining-${account.id}`).relative().h(metrics.row).flex_none().px(10).pt(appearance.sizes.rowPadding).pb(metrics.bottom).rounded(8)
      .on_mouse_down('right', (event, cx) => { cx.stop_propagation(); this.openAccountMenu(account.id, event.position); })
      .bg(t.chrome).tooltip(tooltip).child(top)
      .when(appearance.layout === 'bars' && Boolean(weekly), (e) => e.child(div().absolute().left(10).right(10).bottom(0)
        .h(appearance.sizes.bar).child(this.bar(weekly, account))));
  }

  render(cx) {
    if (this.accountMenu) return this.renderAccountMenu();
    if (this.settings) return this.renderSettings();
    const t = theme();
    const narrow = this.width < 160;
    const prefs = preferences(shared(PREFS));
    const appearance = this.appearance();
    const accounts = orderedAccounts(this.data?.accounts ?? [], prefs.order).filter((a) => !prefs.disabledIds.includes(a.id));
    const columns = quotaColumns(accounts, appearance.show);
    const refreshing = this.busy || Boolean(this.data?.pending);
    const feedback = refreshFeedback({ busy: refreshing, error: this.error, accounts });
    const warning = feedback.kind === 'warning' || feedback.kind === 'error';
    const interval = preferences(shared(PREFS)).refreshMinutes;
    const refreshInfo = `${accounts.map((a) => `${a.label}: ${updated(a.fetchedAt)}${a.error ? ' · ' + a.error : ''}`).join('\n')}\nAuto-refresh every ${interval}m`;
    const root = v_flex().id('remaining-root').size_full().bg(t.chrome).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(this.width - size.width) > 0.5) { this.width = size.width; cx.notify(); } });
    const refresh = this.iconButton('remaining-refresh', 'refresh', `${feedback.message}\nRefresh limits · automatic every ${interval}m`, (_e, cx) => this.refresh(cx, true), { spinning: refreshing, warning });
    root.child(h_flex().h(22).flex_none().px(12).pt(2).items_center().gap(5)
      .when(!narrow, (e) => e.child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.muted)
        .tooltip(feedback.message).child('Remaining')))
      .when(!narrow, (e) => e.child(div().w(56).flex_none().text_right().text_size(10).text_color(warning ? t.working : t.dim)
        .tooltip(`${feedback.message}\n${refreshInfo}`).child(warning ? 'Retrying' : shortAge(oldestFetch(accounts)))))
      .child(refresh)
      .when(!narrow, (e) => e.child(this.iconButton('remaining-settings', 'settings', 'Account monitoring, order & refresh settings', () => this.openSettings())
        .on_mouse_down('left', (e) => { this.settingsAnchor = e.position; }))));
    if (!narrow) {
      root.child(h_flex().px(12).h(10).gap(appearance.sizes.gap).items_center().text_size(8).text_color(t.dim)
        .child(div().flex_1())
        .when(columns.short, (e) => e.child(div().w(rowMetrics(appearance).column).text_center().tooltip('5-hour limit remaining').child('5h')))
        .when(columns.weekly, (e) => e.child(div().w(rowMetrics(appearance).column).text_center().tooltip('Weekly limit remaining · the bar shows this value').child('7d'))));
    }
    root.child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().px(2).gap(1)
      .children(accounts.map((a) => this.card(a, columns)))
      .when(!accounts.length && !narrow, (e) => e.child(div().px(10).py(5).text_size(11).text_color(t.dim)
        .tooltip(this.error || 'Ask your AI to configure existing CLI logins in accounts.json')
        .child(this.busy ? 'Checking CLI accounts…' : this.error ? 'Setup needed · ask your AI' : 'No accounts configured'))));
    return root;
  }
}
