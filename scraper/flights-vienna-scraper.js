import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchCheapFlightsFromVienna } from './flight-finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUTPUT_PATH = path.join(DOCS_DIR, 'deals-pending-flights.json');

async function main() {
  console.log('✈️ FLIGHTS VIENNA SCRAPER');
  console.log('='.repeat(36));

  const payload = await searchCheapFlightsFromVienna({
    limit: 15,
    minNights: 2,
    maxNights: 6,
    maxPrice: 220,
  });

  const deals = payload.results.map((result, index) => toPendingDeal(result, index));
  const output = {
    source: 'Flights Vienna',
    generatedAt: payload.searchedAt,
    providers: payload.providers,
    totalDeals: deals.length,
    errors: payload.errors,
    deals,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ ${deals.length} Flugdeals gespeichert -> ${OUTPUT_PATH}`);
}

function toPendingDeal(result, index) {
  const city = result.destination.city || result.destination.airportCode;
  const country = result.destination.country ? `, ${result.destination.country}` : '';
  const routeText = `${result.outbound.departureDate} → ${result.inbound.departureDate}`;
  const title = `Hin & zurück nach ${city} ab ${result.price.formatted}`;
  const description = [
    `${result.provider}: Roundtrip Wien -> ${city}${country}`,
    `${result.tripDurationDays} Tage`,
    routeText,
  ].join(' · ');

  return {
    id: buildDealId(result, index),
    brand: result.provider,
    logo: '✈️',
    title,
    description,
    type: 'rabatt',
    category: 'reisen',
    source: 'Flights Vienna',
    url: result.bookingUrl,
    expires: `Abflug ${result.outbound.departureDate}`,
    distance: `${city}${country}`,
    hot: result.price.value <= 80,
    isNew: true,
    priority: result.price.value <= 60 ? 1 : 2,
    votes: seedVotes(result.price.value),
    qualityScore: scoreFlight(result.price.value, result.tripDurationDays),
    pubDate: new Date().toISOString(),
    flight: {
      provider: result.provider,
      destination: result.destination,
      tripDurationDays: result.tripDurationDays,
      price: result.price,
      outbound: result.outbound,
      inbound: result.inbound,
      bookingUrl: result.bookingUrl,
      badges: result.badges,
    },
  };
}

function buildDealId(result, index) {
  const base = [
    result.provider,
    result.destination.airportCode,
    result.outbound.departureDate,
    result.inbound.departureDate,
    result.price.value,
    index,
  ].join('|');
  let hash = 5381;
  for (let i = 0; i < base.length; i += 1) {
    hash = ((hash << 5) + hash) ^ base.charCodeAt(i);
    hash >>>= 0;
  }
  return `flight-${hash.toString(36)}`;
}

function seedVotes(priceValue) {
  if (priceValue <= 40) return 24;
  if (priceValue <= 80) return 16;
  if (priceValue <= 120) return 10;
  return 6;
}

function scoreFlight(priceValue, tripDurationDays) {
  let score = 55;
  if (priceValue <= 40) score += 25;
  else if (priceValue <= 80) score += 18;
  else if (priceValue <= 120) score += 10;
  else if (priceValue <= 180) score += 4;

  if (tripDurationDays >= 2 && tripDurationDays <= 5) score += 6;
  return Math.min(score, 95);
}

main().catch((error) => {
  console.error('❌ flights-vienna-scraper failed:', error.message);
  process.exit(1);
});
