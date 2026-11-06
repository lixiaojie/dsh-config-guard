// Settings endpoints for the read-only card. Two GET routes, nothing else: the
// host does not enforce same-origin for plugin routes, so each handler checks
// `sec-fetch-site` / Origin itself (same pattern as dsh-llm-cli-bridges).
export const ROUTE = '/config-guard';

export function sameOrigin(request) {
  const site = request.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false;
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      return new URL(origin).host === request.headers.host;
    } catch {
      return false;
    }
  }
  return true;
}

export function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

/**
 * Register the two read-only endpoints. Anything that is not a same-origin GET
 * fails closed: unknown paths with 404, other verbs with 405.
 * @param handlers.state () => Promise<object>
 * @param handlers.assets () => Promise<object>
 */
export function registerRoutes(ctx, handlers) {
  return ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          sendJson(response, 405, { ok: false, error: { code: 'method_not_allowed', message: 'this build is read-only' } });
          return;
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'cross-origin request' } });
          return;
        }
        const path = String(request.url ?? '').split('?')[0];
        try {
          if (path === `${ROUTE}/state`) {
            sendJson(response, 200, await handlers.state());
            return;
          }
          if (path === `${ROUTE}/assets`) {
            sendJson(response, 200, await handlers.assets());
            return;
          }
          sendJson(response, 404, { ok: false, error: { code: 'not_found', message: path } });
        } catch (error) {
          sendJson(response, 500, { ok: false, error: { code: 'failed', message: error instanceof Error ? error.message : String(error) } });
        }
      },
    }),
  );
}
