export const FLIGHT_ALTERNATIVES_PATH = 'reviews/city-flight-alternatives.json';

export function isViennaFlight(deal) {
  return /^flight-[a-z0-9]+$/i.test(deal?.id ?? '') && deal.category === 'reisen'
    && (deal.originSource || deal.source) === 'Flights Vienna' && Boolean(deal.flight?.destination);
}
