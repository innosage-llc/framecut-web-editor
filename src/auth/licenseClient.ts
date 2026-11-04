export interface SharedLicense {
  id: string; status: string; edition: string; billing_kind: 'perpetual' | 'subscription';
  ent_exp: number | null; updates_until: number | null; key_suffix: string | null;
}
export interface AccountState {
  ready: boolean; authenticated: boolean; pro: boolean; email?: string; csrf?: string;
  session_id?: string; session_active?: boolean; session_released?: boolean; lease_until?: number;
  licenses: SharedLicense[]; sessions: { id: string; label: string; last_seen: number }[];
  sandbox?: boolean; error?: string;
}
const empty: AccountState = { ready: false, authenticated: false, pro: false, licenses: [], sessions: [] };
let state: AccountState = empty;
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;
function publish(next: AccountState) { state = next; listeners.forEach(listener => listener()); }
function serial<T>(action: () => Promise<T>): Promise<T> {
  pending++;
  const result = queue.then(action);
  queue = result.catch(() => undefined).finally(() => { pending--; });
  return result;
}
async function request(route: string, body?: unknown, csrf = state.csrf): Promise<any> {
  const response = await fetch(`/api/licensing/${route}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', ...(csrf ? { 'X-FrameCut-CSRF': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || 'Account service is unavailable. Please try again.');
  return data;
}
async function refreshAccount(): Promise<AccountState> {
  try {
    let result = await request('account');
    if (result.authenticated) result = await request('heartbeat', {}, result.csrf);
    publish({ ...empty, ...result, ready: true });
  } catch {
    publish({ ...state, ready: true, pro: false, error: 'Account service is unavailable. Free export remains available.' });
  }
  return state;
}
export const licensing = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot: () => state,
  refresh: () => serial(refreshAccount),
  async exportAccess(): Promise<boolean> {
    if (state.ready && !state.authenticated) return false;
    const current = await serial(refreshAccount);
    return current.pro && current.session_active === true && (current.lease_until || 0) * 1000 > Date.now();
  },
  requestCode: (email: string): Promise<{ challenge_id: string }> => serial(() => request('signin/request', { email })),
  verify: (challenge_id: string, code: string) => serial(async () => {
    const result = await request('signin/verify', { challenge_id, code });
    publish({ ...empty, ...result, ready: true });
  }),
  redeem: (key: string) => serial(async () => { await request('redeem', { key }); await refreshAccount(); }),
  release: (session_id: string) => serial(async () => { await request('release', { session_id }); await refreshAccount(); }),
  resume: () => serial(async () => { const result = await request('resume', {}); publish({ ...empty, ...result, ready: true }); }),
  logout: () => serial(async () => { await request('logout', {}); publish({ ...empty, ready: true }); }),
  checkout: (sku_id: string): Promise<{ url: string }> => serial(() => request('checkout', { sku_id })),
  billing: (license_id: string): Promise<{ url: string }> => serial(() => request('billing', { license_id })),
  start() {
    void this.refresh();
    const update = () => { if (!pending) void this.refresh(); };
    const heartbeat = setInterval(update, 30000);
    const expiry = setInterval(() => {
      if (state.pro && (state.lease_until || 0) * 1000 <= Date.now()) publish({ ...state, pro: false, session_active: false });
    }, 5000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    // Cookies are shared across tabs. Focus/heartbeat reconcile all tabs with the same browser login.
    return () => { clearInterval(heartbeat); clearInterval(expiry); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  },
};
