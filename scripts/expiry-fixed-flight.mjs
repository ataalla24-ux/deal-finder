const bookingOrigin = 'https://www.ryanair.com';
const bookingPath = '/gb/en/trip/flights/select';
const bookingAliases = {
  tpAdults: 'adults', tpTeens: 'teens', tpChildren: 'children', tpInfants: 'infants',
  tpOriginIata: 'originIata', tpDestinationIata: 'destinationIata',
  tpStartDate: 'dateOut', tpEndDate: 'dateIn', tpIsReturn: 'isReturn',
  tpDiscount: 'discount', tpPromoCode: 'promoCode',
};
const bookingFields = new Set([...Object.values(bookingAliases), ...Object.keys(bookingAliases)]);

function exactDay(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function matchesBookingUrl(value, expected) {
  if (typeof value !== 'string' || !value.startsWith(`${bookingOrigin}${bookingPath}?`)) return false;
  const url = URL.parse(value);
  if (!url || url.origin !== bookingOrigin || url.pathname !== bookingPath || url.hash) return false;
  const fields = url.searchParams;
  if ([...fields.keys()].some(key => !bookingFields.has(key) || fields.getAll(key).length !== 1)) return false;
  if (Object.entries(bookingAliases).some(([key, primary]) => fields.has(key) && fields.get(key) !== fields.get(primary))) return false;
  return Object.entries(expected).every(([key, item]) => fields.get(key) === item);
}

function recordedEnd(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('Abflug ')) return exactDay(value.slice(7));
  if (value.length === 10) return exactDay(value);
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return '';
  return exactDay(value.slice(0, 10));
}

function agreesWithTripCopy(value, outbound, inbound) {
  if (typeof value !== 'string') return true;
  if (/\b(?:verschoben|verlegt|verlängert|verlaengert|umbuchbar|undatiert|undated|rescheduled|date flexible|flexible dates)\b/iu.test(value)) return false;
  // The price snapshot can have a separate date. Only explicit leg labels and
  // the flight collector's date pair describe the actual itinerary.
  const labels = /\b(Hinflug|Abflug|Rückflug|Rueckflug)\b/giu;
  for (const match of value.matchAll(labels)) {
    const prefix = value.slice(0, match.index);
    if (/\b(?:kein(?:en)?|nicht|no|not)\s+(?:\w+\s+){0,2}$/iu.test(prefix)) return false;
    const after = value.slice(match.index + match[0].length);
    const date = after.match(/^\s*:?\s*(?:am\s+)?(20\d{2}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.20\d{2})\b/u);
    if (!date || /^\s*(?:oder|or|bis|to|und|and|\/)\s*(?:am\s+)?\d/iu.test(after.slice(date[0].length))) return false;
    const [day, month, year] = date[1].split('.');
    const expected = /^(?:Hinflug|Abflug)$/iu.test(match[0]) ? outbound : inbound;
    if ((year ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : date[1]) !== expected) return false;
  }
  return [...value.matchAll(/\b(20\d{2}-\d{2}-\d{2})\s*→\s*(20\d{2}-\d{2}-\d{2})\b/gu)]
    .every(([, start, finish]) => start === outbound && finish === inbound);
}

// The caller still checks the current date, grace period and owner overrides.
// The departure date closes this exact itinerary even when the fare was a quote.
export function assessFixedFlightEnd(deal) {
  if (!/^flight-[a-z0-9]+$/.test(deal?.id || '') || deal.category !== 'reisen' || deal.type !== 'rabatt'
    || (deal.originSource || deal.source) !== 'Flights Vienna' || deal.brand !== 'Ryanair'
    || deal.flight?.provider !== 'Ryanair' || deal.expiryKind !== 'end'
    || deal.forceKeep || deal.campaignId || deal.isBusinessAdvertisement) return '';

  const { flight } = deal;
  const outbound = exactDay(flight.outbound?.departureDate);
  const inbound = exactDay(flight.inbound?.departureDate);
  const destination = flight.destination?.airportCode;
  if (!outbound || !inbound || outbound >= inbound || !/^[A-Z]{3}$/.test(destination || '') || destination === 'VIE'
    || deal.validUntil !== outbound || (deal.validOn && deal.validOn !== outbound)
    || (deal.validFrom && (!exactDay(deal.validFrom) || deal.validFrom > outbound))) return '';
  const duration = (Date.parse(inbound) - Date.parse(outbound)) / 86_400_000;
  if (flight.tripDurationDays != null && flight.tripDurationDays !== duration) return '';
  if ([deal.expires, deal.expiresOriginal, deal.expiryDisplayText, deal.validity?.expiryDate]
    .some(value => value && recordedEnd(value) !== outbound)) return '';

  const route = { originIata: 'VIE', destinationIata: destination, dateOut: outbound, dateIn: inbound, isReturn: 'true' };
  if (![deal.url, flight.bookingUrl].every(url => matchesBookingUrl(url, route))
    || (deal.validity?.finalUrl && !matchesBookingUrl(deal.validity.finalUrl, route))) return '';
  return [deal.title, deal.description].every(value => agreesWithTripCopy(value, outbound, inbound)) ? outbound : '';
}
