const RYANAIR_MARKET = 'en-gb';
const RYANAIR_LANGUAGE = 'en';
const RYANAIR_ORIGIN = 'https://www.ryanair.com';
const KIWI_ORIGIN = 'https://api.tequila.kiwi.com';
const DEFAULT_ORIGIN = 'VIE';
const KIWI_API_KEY = process.env.KIWI_API_KEY || '';

export async function searchCheapFlightsFromVienna(options = {}) {
  const search = normalizeSearchOptions(options);
  const providerRuns = [
    { name: 'Ryanair', runner: () => searchRyanairRoundTrips(search) },
  ];

  if (KIWI_API_KEY) {
    providerRuns.push({ name: 'Kiwi', runner: () => searchKiwiRoundTrips(search) });
  }

  const settled = await Promise.allSettled(providerRuns.map((entry) => entry.runner()));
  const providers = [];
  const errors = [];
  const aggregated = [];

  settled.forEach((result, index) => {
    const providerName = providerRuns[index].name;
    if (result.status === 'fulfilled') {
      providers.push(providerName);
      aggregated.push(...result.value);
      return;
    }

    errors.push({
      provider: providerName,
      message: result.reason?.message || 'Quelle nicht erreichbar.',
    });
  });

  if (!providers.length) {
    throw new Error(errors[0]?.message || 'Es konnten keine Flugdaten geladen werden.');
  }

  const results = dedupeAndSortResults(aggregated).slice(0, search.limit);

  return {
    providers,
    searchedAt: new Date().toISOString(),
    search,
    totalFound: results.length,
    limitations: buildLimitations(),
    errors,
    results,
  };
}

async function searchRyanairRoundTrips(search) {
  const params = new URLSearchParams({
    departureAirportIataCode: search.originAirport,
    outboundDepartureDateFrom: search.startDate,
    outboundDepartureDateTo: search.endDate,
    inboundDepartureDateFrom: addDays(search.startDate, search.minNights),
    inboundDepartureDateTo: addDays(search.endDate, search.maxNights),
    adultPaxCount: String(search.adults),
    market: RYANAIR_MARKET,
    language: RYANAIR_LANGUAGE,
  });

  const url = `${RYANAIR_ORIGIN}/api/farfnd/v4/roundTripFares?${params.toString()}`;
  const payload = await fetchJson(url);
  const fares = Array.isArray(payload?.fares) ? payload.fares : [];

  return fares
    .map((fare) => mapRyanairFare(fare, search, url))
    .filter(Boolean)
    .filter((fare) => fare.tripDurationDays >= search.minNights && fare.tripDurationDays <= search.maxNights)
    .filter((fare) => (search.maxPrice !== null ? fare.price.value <= search.maxPrice : true));
}

async function searchKiwiRoundTrips(search) {
  const params = new URLSearchParams({
    fly_from: search.originAirport,
    fly_to: 'anywhere',
    date_from: formatKiwiDate(search.startDate),
    date_to: formatKiwiDate(search.endDate),
    return_from: formatKiwiDate(addDays(search.startDate, search.minNights)),
    return_to: formatKiwiDate(addDays(search.endDate, search.maxNights)),
    adults: String(search.adults),
    curr: 'EUR',
    limit: String(Math.min(Math.max(search.limit * 3, 30), 200)),
    sort: 'price',
    asc: '1',
    max_stopovers: '0',
    one_for_city: '1',
  });

  if (search.maxPrice !== null) {
    params.set('price_to', String(search.maxPrice));
  }

  const url = `${KIWI_ORIGIN}/v2/search?${params.toString()}`;
  const payload = await fetchJson(url, {
    apikey: KIWI_API_KEY,
    accept: 'application/json',
  });
  const fares = Array.isArray(payload?.data) ? payload.data : [];

  return fares
    .map((fare) => mapKiwiFare(fare, search, url))
    .filter(Boolean)
    .filter((fare) => fare.tripDurationDays >= search.minNights && fare.tripDurationDays <= search.maxNights)
    .filter((fare) => (search.maxPrice !== null ? fare.price.value <= search.maxPrice : true));
}

function normalizeSearchOptions(options) {
  const today = isoDate(new Date());
  const startDate = sanitizeIsoDate(options.startDate, addDays(today, 14));
  const endDate = sanitizeIsoDate(options.endDate, addDays(startDate, 45));
  const adults = clampInt(options.adults, 1, 4, 1);
  const limit = clampInt(options.limit, 1, 50, 15);
  const minNights = clampInt(options.minNights, 1, 30, 3);
  const maxNights = clampInt(options.maxNights, minNights, 30, 7);
  const maxPrice =
    options.maxPrice === undefined || options.maxPrice === null || options.maxPrice === ''
      ? null
      : clampNumber(options.maxPrice, 1, 5000);

  if (startDate > endDate) {
    throw new Error('Das Startdatum muss vor dem Enddatum liegen.');
  }

  return {
    originAirport: DEFAULT_ORIGIN,
    startDate,
    endDate,
    adults,
    limit,
    minNights,
    maxNights,
    maxPrice,
  };
}

function mapRyanairFare(fare, search, sourceUrl) {
  if (!fare?.outbound || !fare?.inbound || !fare?.summary?.price) {
    return null;
  }

  const outbound = mapRyanairLeg(fare.outbound);
  const inbound = mapRyanairLeg(fare.inbound);
  const arrivalAirport = fare.outbound.arrivalAirport || {};
  const city = arrivalAirport.city || {};
  const price = fare.summary.price;
  const priceValue = Number(price.value);

  if (!Number.isFinite(priceValue)) {
    return null;
  }

  return {
    provider: 'Ryanair',
    sourceUrl,
    destination: {
      city: city.name || arrivalAirport.name || arrivalAirport.iataCode,
      airportName: arrivalAirport.name || arrivalAirport.iataCode,
      airportCode: arrivalAirport.iataCode,
      country: arrivalAirport.countryName || '',
    },
    tripDurationDays: fare.summary.tripDurationDays || diffDays(outbound.departureDate, inbound.departureDate),
    price: {
      value: priceValue,
      formatted: `${price.currencySymbol || '€'}${priceValue.toFixed(2)}`,
      currencyCode: price.currencyCode || 'EUR',
    },
    outbound,
    inbound,
    bookingUrl: buildRyanairBookingUrl({
      outbound,
      inbound,
      adults: search.adults,
      destinationIata: arrivalAirport.iataCode,
    }),
    badges: buildBadges('Ryanair', priceValue),
  };
}

function mapKiwiFare(fare, search, sourceUrl) {
  if (!fare || !Array.isArray(fare.route) || fare.route.length < 2) {
    return null;
  }

  const outboundRoute = fare.route.filter((segment) => segment.return === 0);
  const inboundRoute = fare.route.filter((segment) => segment.return === 1);

  if (outboundRoute.length !== 1 || inboundRoute.length !== 1) {
    return null;
  }

  const outbound = mapKiwiLeg(outboundRoute[0]);
  const inbound = mapKiwiLeg(inboundRoute[0]);
  const cityTo = fare.cityTo || fare.flyTo || '';
  const countryTo = fare.countryTo?.name || '';
  const priceValue = Number(fare.price);

  if (!Number.isFinite(priceValue)) {
    return null;
  }

  return {
    provider: 'Kiwi',
    sourceUrl,
    destination: {
      city: cityTo,
      airportName: fare.flyTo || cityTo,
      airportCode: fare.flyTo || '',
      country: countryTo,
    },
    tripDurationDays: diffDays(outbound.departureDate, inbound.departureDate),
    price: {
      value: priceValue,
      formatted: `€${priceValue.toFixed(2)}`,
      currencyCode: 'EUR',
    },
    outbound,
    inbound,
    bookingUrl: fare.deep_link || sourceUrl,
    badges: buildBadges('Kiwi', priceValue),
  };
}

function dedupeAndSortResults(results) {
  const map = new Map();

  results.forEach((result) => {
    const key = [
      result.destination.airportCode,
      result.outbound.departureDate,
      result.inbound.departureDate,
      result.price.value,
    ].join('|');
    const existing = map.get(key);
    if (!existing || providerPriority(result.provider) < providerPriority(existing.provider)) {
      map.set(key, result);
    }
  });

  return Array.from(map.values()).sort((left, right) => {
    if (left.price.value !== right.price.value) return left.price.value - right.price.value;
    if (left.tripDurationDays !== right.tripDurationDays) return left.tripDurationDays - right.tripDurationDays;
    return left.destination.city.localeCompare(right.destination.city);
  });
}

function providerPriority(provider) {
  return provider === 'Ryanair' ? 0 : 1;
}

function mapRyanairLeg(leg) {
  return {
    departureDate: String(leg.departureDate || '').slice(0, 10),
    departureTime: normalizeTime(leg.departureTime),
  };
}

function mapKiwiLeg(segment) {
  const local = segment.local_departure || segment.utc_departure || '';
  const date = local.slice(0, 10);
  const time = normalizeTime(local.slice(11, 16));
  return {
    departureDate: date,
    departureTime: time,
  };
}

function buildRyanairBookingUrl({ outbound, inbound, adults, destinationIata }) {
  const params = new URLSearchParams({
    adults: String(adults),
    teens: '0',
    children: '0',
    infants: '0',
    originIata: DEFAULT_ORIGIN,
    destinationIata: destinationIata || '',
    dateOut: outbound.departureDate,
    dateIn: inbound.departureDate,
    isReturn: 'true',
    discount: '0',
    promoCode: '',
  });
  return `${RYANAIR_ORIGIN}/gb/en/trip/flights/select?${params.toString()}`;
}

function buildBadges(provider, priceValue) {
  const badges = ['Roundtrip', 'Direkt'];
  if (provider === 'Ryanair') badges.push('Live-Fare');
  if (provider === 'Kiwi') badges.push('Meta-Suche');
  if (priceValue <= 40) badges.unshift('Top-Schnäppchen');
  else if (priceValue <= 80) badges.unshift('Schnäppchen');
  return badges;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} antwortete mit ${response.status}`);
  }

  return response.json();
}

function sanitizeIsoDate(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return isoDate(parsed);
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(Math.max(num, min), max);
}

function addDays(dateInput, days) {
  const date = new Date(`${dateInput}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return isoDate(date);
}

function diffDays(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  const a = new Date(`${dateA}T00:00:00Z`);
  const b = new Date(`${dateB}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function formatKiwiDate(iso) {
  const [year, month, day] = String(iso).split('-');
  return `${day}/${month}/${year}`;
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(\d{2}:\d{2})/);
  return match ? match[1] : raw;
}

function buildLimitations() {
  const limitations = ['Nur Hin-und-zurück', 'Nur Direktflüge', 'Abflug Wien (VIE)'];
  if (!KIWI_API_KEY) {
    limitations.push('Kiwi nicht konfiguriert, nur Ryanair aktiv');
  }
  return limitations;
}
