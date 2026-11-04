// A first-party cookie boundary; no browser-accessible Stripe or proxy credentials.
export const onRequest = async ({ request, env, params }: {
  request: Request; env: { LICENSING_ORIGIN?: string; WEB_PROXY_TOKEN?: string; LICENSING?: { fetch(request: Request): Promise<Response> } }; params: { path?: string[] };
}): Promise<Response> => {
  const origin = new URL(request.url).origin;
  const route = (params.path || []).join('/');
  const allowed = ['account', 'signin/request', 'signin/verify', 'heartbeat', 'resume', 'redeem', 'release', 'logout', 'checkout', 'billing'];
  const failure = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
  if (!allowed.includes(route) || !['GET', 'POST'].includes(request.method)) return failure(404, 'Unknown account route.');
  if (!env.LICENSING_ORIGIN || !env.WEB_PROXY_TOKEN) return failure(503, 'Accounts are not configured for this deployment.');
  let backend: URL;
  try { backend = new URL(env.LICENSING_ORIGIN); } catch { return failure(503, 'Account configuration is invalid.'); }
  if (backend.protocol !== 'https:' || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) return failure(503, 'Account configuration is invalid.');
  if (request.method === 'POST' && request.headers.get('Origin') !== origin) return failure(403, 'Refresh this page and try again.');
  const headers = new Headers({
    Origin: origin, 'X-FrameCut-Proxy': env.WEB_PROXY_TOKEN,
    'X-FrameCut-Client-IP': request.headers.get('CF-Connecting-IP') || 'unknown',
    'User-Agent': request.headers.get('User-Agent') || 'Browser',
  });
  const session = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('__Host-framecut_session='));
  if (session) headers.set('Cookie', session);
  const csrf = request.headers.get('X-FrameCut-CSRF');
  if (csrf) headers.set('X-FrameCut-CSRF', csrf);
  try {
    let body: Uint8Array | undefined;
    if (request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return failure(415, 'JSON is required.');
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      if (reader) {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.length;
          if (length > 16384) { await reader.cancel(); return failure(413, 'Request is too large.'); }
          chunks.push(next.value);
        }
      }
      body = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
      headers.set('Content-Type', 'application/json'); headers.set('Content-Length', String(length));
    }
    const upstreamRequest = new Request(`${backend.origin}/v1/web/${route}`, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const upstream = env.LICENSING ? await env.LICENSING.fetch(upstreamRequest) : await fetch(upstreamRequest);
    if (upstream.status >= 300 && upstream.status < 400) return failure(502, 'Unexpected account service redirect.');
    const responseHeaders = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    const cookie = upstream.headers.get('Set-Cookie');
    if (cookie) responseHeaders.set('Set-Cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error('account_proxy_failed', error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'request_failure');
    return failure(503, 'Account service is temporarily unavailable.');
  }
};
