import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { theme, appHome, writeTextFile } from 'herdr';
import Remaining from './remaining-view.js';
import { DEFAULT_THEMES } from './theme-format.mjs';
import { rowMetrics } from './presentation.mjs';

export default class RemainingPreview extends Remaining {
  init() {
    this.width = 300;
    this.error = null;
    const now = Date.now();
    this.examples = [
      { id: 'example-claude', provider: 'claude', label: 'Claude', badge: 'C', tint: 'ansi3', used: [22, 40], reset: [80, 3 * 1440 + 12 * 60] },
      { id: 'example-work', provider: 'codex', label: 'Work · Codex', badge: 'W', tint: 'ansi2', used: [60, 75], reset: [190, 4 * 1440 + 19 * 60] },
      { id: 'example-personal', provider: 'codex', label: 'Personal · Codex', badge: 'P', tint: 'ansi4', used: [null, 100], reset: [null, 3 * 1440 + 2 * 60] },
    ].map((account) => ({ ...account, status: 'ok', fetchedAt: now, windows: [300, 10080].flatMap((minutes, index) => account.used[index] === null ? [] : [{
      label: index ? 'Weekly' : '5-hour', minutes, used: account.used[index], resetAt: now + account.reset[index] * 60000,
    }]) }));
  }
  appearance() { return DEFAULT_THEMES.find((appearance) => appearance.id === this.style) ?? DEFAULT_THEMES[0]; }
  openAccountMenu() {}
  panel(style) {
    this.style = style;
    const t = theme();
    const column = rowMetrics(this.appearance()).column;
    return v_flex().w(324).flex_none().gap(10)
      .child(div().text_size(12).font_semibold().text_color(t.muted).child(style === 'bars' ? 'Bars · default' : 'Rings · optional'))
      .child(v_flex().p(12).rounded(10).border_1().border_color(t.border).bg(t.chrome)
        .child(h_flex().h(22).px(12).items_center()
          .child(div().flex_1().text_size(11).font_semibold().text_color(t.muted).child('Remaining'))
          .child(div().text_size(10).text_color(t.dim).child('now')))
        .child(h_flex().h(10).px(12).gap(6).text_size(8).text_color(t.dim)
          .child(div().flex_1()).children(['5h', '7d'].map((label) => div().w(column).text_center().child(label))))
        .child(v_flex().px(2).gap(1).children(this.examples.map((account) => this.card(account, { short: true, weekly: true })))));
  }
  render() {
    const t = theme();
    return v_flex().id('remaining-gallery-root').size_full().p(24).gap(18).bg(t.chrome).text_color(t.foreground)
      .on_size_change((_size, cx) => {
        if (this.recorded) return;
        this.recorded = true;
        const viewport = globalThis.window.viewport_size();
        cx.spawn(async () => { await writeTextFile(`${appHome()}/mods/remaining-gallery-preview/.geometry.json`, JSON.stringify(viewport), null); });
      })
      .child(v_flex().gap(5)
        .child(div().text_size(22).font_semibold().child('Remaining'))
        .child(div().text_size(12).text_color(t.muted).child('Claude & Codex limits, in your Herdr sidebar')))
      .child(h_flex().gap(24).child(this.panel('bars')).child(this.panel('rings')))
      .child(div().text_size(11).text_color(t.muted).child('Example data · reset countdowns · local JSON themes'));
  }
}
