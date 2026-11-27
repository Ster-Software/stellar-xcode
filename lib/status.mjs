// An Xcode action in Stellar's status bar while it runs (statusBar.item), and how it ended for a little while after.
import { automations, statusBar, terminal } from 'stellar/extension';

const SHOW_RESULT_MS = 15000;
let shown = null; // { item, timer }

/** Follows terminal `id` running `label` ("build App"): busy, then success or failure. */
export function trackAction(id, label) {
  if (!id) return;
  clearTimeout(shown?.timer);
  shown?.item.dispose();
  const item = statusBar.item({ id: 'action', text: `${label}…`, icon: 'Hammer', tooltip: label, alignment: 'left', priority: 10 });
  shown = { item, timer: null };
  const ended = terminal.onExit(id, ({ exitCode }) => {
    ended.dispose();
    const ok = exitCode === 0;
    item.update({ text: label, icon: ok ? 'Check' : 'X', tone: ok ? 'success' : 'error' });
    // For automations on "Een Xcode-actie is klaar" (manifest automations.triggers).
    const [actie, ...scheme] = label.split(' ');
    automations.trigger('action-done', { actie, scheme: scheme.join(' '), uitslag: ok ? 'gelukt' : 'mislukt', exitcode: exitCode ?? '' }).catch(() => {});
    const current = shown;
    if (current?.item === item) current.timer = setTimeout(() => { item.dispose(); if (shown === current) shown = null; }, SHOW_RESULT_MS);
  });
}
