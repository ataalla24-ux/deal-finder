export function assessJoeAuthPage(page = {}, offerCount = 0) {
  if (page.requiresLogin || /\/(?:login|anmelden|signin)(?:[/?#]|$)/i.test(page.url || '')) {
    return { status: 'login-required', authenticated: false, readableOffers: 0 };
  }
  if (page.authenticatedControls !== true) return { status: 'unverified-session', authenticated: false, readableOffers: 0 };
  return { status: offerCount > 0 ? 'authenticated-offers-read' : 'authenticated-no-readable-offers', authenticated: true, readableOffers: offerCount };
}
