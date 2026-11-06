interface Env { ASSETS: Fetcher; API_BASE_URL?: string; UPSTREAM_ORIGIN?: string }

const securityHeaders: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
};

function json(error: string, status: number) {
  return Response.json({ error: { message: error } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function validBase(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return url;
  } catch {}
  return null;
}

async function proxy(request: Request, env: Env) {
  const requestUrl = new URL(request.url), base = validBase(env.API_BASE_URL);
  if (!base) return json('API_BASE_URL não está configurada com um endpoint HTTPS válido.', 503);
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return json('Método não permitido.', 405);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== requestUrl.origin) return json('Origem inválida.', 403);

  const upstreamUrl = new URL(requestUrl.pathname.slice('/api'.length) + requestUrl.search, base);
  const headers = new Headers();
  for (const name of ['accept', 'content-type', 'cookie', 'user-agent']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  headers.set('origin', env.UPSTREAM_ORIGIN || requestUrl.origin);
  headers.set('x-forwarded-host', requestUrl.host);
  headers.set('x-forwarded-proto', requestUrl.protocol.slice(0, -1));

  try {
    const response = await fetch(upstreamUrl, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const outputHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'location', 'retry-after']) { const value = response.headers.get(name); if (value) outputHeaders.set(name, value); }
    outputHeaders.set('Cache-Control', 'no-store');
    outputHeaders.set('X-Content-Type-Options', 'nosniff');
    const cookieHeaders = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);
    for (const value of cookieHeaders) outputHeaders.append('Set-Cookie', value.replace(/Path=\/v1\/auth/gi, 'Path=/api/v1/auth'));
    return new Response(response.body, { status: response.status, headers: outputHeaders });
  } catch {
    return json('API temporariamente indisponível.', 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return proxy(request, env);
    const response = await env.ASSETS.fetch(request), headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
