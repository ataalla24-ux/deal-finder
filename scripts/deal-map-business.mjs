export const CAMPAIGNS_URL = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/merchant/campaigns';

export function activeBusinessDeals(snapshot = {}, now = new Date()) {
  return (snapshot.deals || []).filter(deal => /^merchant-[a-zA-Z0-9-]+$/.test(deal.id || '')
    && Date.parse(deal.validUntil) > now.getTime());
}

export async function refreshBusinessSnapshot({ snapshot = {}, now = new Date(), fetcher = fetch } = {}) {
  try {
    const response = await fetcher(CAMPAIGNS_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Campaign feed HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.ok !== true || !Array.isArray(payload.campaigns)) throw new Error('Invalid campaign feed');
    const text = value => String(value || '').trim();
    const deals = payload.campaigns.flatMap(campaign => {
      const id = text(campaign.id);
      if (!/^[a-zA-Z0-9-]+$/.test(id) || !text(campaign.restaurantName) || !text(campaign.dealTitle)
        || !Number.isFinite(campaign.endsAt) || campaign.endsAt <= now.getTime()
        || ['hidden', 'cancelled', 'deleted'].includes(campaign.status)) return [];
      // Only public offer fields. Never persist receipts, contacts or promo claims.
      return [{ id: `merchant-${id}`, brand: text(campaign.restaurantName), title: text(campaign.dealTitle),
        description: text(campaign.description), address: text(campaign.address), distance: text(campaign.address),
        url: text(campaign.ctaURL), offerValidityText: text(campaign.offerValidityText),
        validFrom: Number.isFinite(campaign.startsAt) ? new Date(campaign.startsAt).toISOString() : '',
        validUntil: new Date(campaign.endsAt).toISOString(), source: 'Business-Anzeige' }];
    }).sort((a, b) => a.id.localeCompare(b.id));
    return { snapshot: { schemaVersion: 1, deals }, error: null };
  } catch (error) {
    return { snapshot: { schemaVersion: 1, deals: activeBusinessDeals(snapshot, now) }, error: error.message };
  }
}
