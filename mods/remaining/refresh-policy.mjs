export const REFRESH_MS = 5 * 60 * 1000;
export const RETRY_MS = 60 * 1000;

export function nextRefreshAt(snapshot, now = Date.now()) {
  const accounts = snapshot?.accounts ?? [];
  if (accounts.length && accounts.every((a) => a.status === 'ok' && Number.isFinite(a.fetchedAt))) {
    return Math.min(...accounts.map((a) => a.fetchedAt)) + (snapshot.refreshMs ?? REFRESH_MS);
  }
  const interval = accounts.length ? RETRY_MS : snapshot?.refreshMs ?? REFRESH_MS;
  return Number.isFinite(snapshot?.checkedAt) ? snapshot.checkedAt + interval : now;
}
