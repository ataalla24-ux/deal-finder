const CODE = /^RM-[A-F0-9]{24}$/;
const TOKEN = /^[A-Za-z0-9_-]{16}$/;
const DEAL = /^[A-Za-z0-9_-]{1,160}$/;

// Encode all 96 bits of the existing public invitation ID; no alias database.
export function invitationToken(code) {
  if (typeof code !== 'string' || code.length !== 27 || !CODE.test(code)) return null;
  const bytes = code.slice(3).match(/../g).map(value => parseInt(value, 16));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
}

export function invitationCode(token) {
  if (typeof token !== 'string' || token.length !== 16 || !TOKEN.test(token)) return null;
  const bytes = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
  return 'RM-' + Array.from(bytes, byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function response(request, body, status, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export default {
  fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return response(request, 'Method not allowed', 405, { Allow: 'GET, HEAD' });
    }
    const url = new URL(request.url);
    if (url.pathname === '/_link-health') {
      return response(request, 'FreeFinder invitation links v1', 200);
    }
    const destination = new URL('https://freefinder.at/');
    if (url.pathname.startsWith('/i/')) {
      const code = invitationCode(url.pathname.slice(3));
      const deals = url.searchParams.getAll('deal');
      if (!code || deals.length > 1 || (deals.length === 1 && (!DEAL.test(deals[0]) || deals[0].length > 160)) ||
          [...url.searchParams.keys()].some(key => key !== 'deal')) {
        return response(request, 'Dieser Einladungslink ist ungueltig.', 404, { 'X-Robots-Tag': 'noindex' });
      }
      destination.pathname = '/invite.html';
      destination.searchParams.set('invite', code);
      if (deals.length) destination.searchParams.set('deal', deals[0]);
      // Redirect to the URL understood by existing apps before any account action.
      return response(request, '', 302, { Location: destination.href, 'X-Robots-Tag': 'noindex' });
    }
    // Preserve the existing www-to-apex redirect for every other website URL.
    destination.pathname = url.pathname;
    destination.search = url.search;
    return response(request, '', 301, { Location: destination.href });
  },
};
