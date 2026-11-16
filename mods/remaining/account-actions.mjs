const PAGES = Object.freeze({
  codex: 'https://chatgpt.com/codex/settings/usage',
  claude: 'https://claude.ai/settings/usage',
});

export function usagePage(provider) {
  return Object.hasOwn(PAGES, provider) ? PAGES[provider] : null;
}

export function refreshFeedback({ busy = false, error = null, accounts = [] } = {}) {
  if (busy) return { kind: 'refreshing', message: 'Refreshing limits…' };
  if (error) return { kind: 'error', message: 'Refresh failed · saved values may be out of date' };
  const failed = accounts.filter((account) => account.status === 'stale' || account.status === 'error' || account.error).length;
  return failed ? { kind: 'warning', message: `${failed} account update${failed === 1 ? '' : 's'} failed · retrying automatically` }
    : { kind: 'idle', message: 'Subscription limits remaining · details on hover' };
}

export function refreshResult(previous, next) {
  if (!Array.isArray(next?.accounts)) throw new Error('Invalid snapshot');
  return { data: next.error && previous?.accounts?.length ? previous : next, error: next.error || null };
}
