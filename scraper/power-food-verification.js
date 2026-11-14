import { load } from "cheerio";
import { POWER_FOOD_SOURCES, isAllowedFoodUrl } from "./power-food-sources.js";
import { extractFoodOffers } from "./power-food-extraction.js";
import { sourceHttpError } from "./source-http-policy.js";
import { extractCouponMediaOffers } from './official-coupon-media.js';
import { parseExpiryShape } from './expiry-utils.js';

// Transport provenance stays local to the verifier, separate from caller-owned
// evidence timestamps and serialized caches. One run may share its page read.
const currentFetches = new WeakMap();

function sameCurrentLandingPage(url, source) {
  try { return new URL(url).href === new URL(source.url).href; } catch { return false; }
}

function preservesKnownPeriod(deal, extracted, now) {
  const same = (field, value) => !value || (/T\d{2}:\d{2}/.test(String(value))
    ? value === extracted[field] : String(value).slice(0, 10) === String(extracted[field] || '').slice(0, 10));
  if (['validOn', 'validFrom', 'validUntil'].some(field => !same(field, deal[field]))) return false;
  if (['validFrom', 'validUntil'].some(field => !same(field, deal.evidence?.offerTiming?.[field]))) return false;
  for (const literal of [deal.expires, deal.expiresOriginal, deal.expiryDisplayText, deal.end_date, deal.validity_date]) {
    if (!literal) continue;
    if (/T\d{2}:\d{2}/.test(String(literal)) && literal !== extracted.expires) return false;
    const shape = parseExpiryShape(literal, { now });
    if (['validOn', 'validFrom', 'validUntil'].some(field => !same(field, shape[field]))) return false;
  }
  return true;
}

function currentOfferVerification(deal, match, source, response, transport, now) {
  if (source.currentOffers !== true || deal.evidence?.media || response.status !== 200
    || !sameCurrentLandingPage(deal.url, source) || !sameCurrentLandingPage(response.finalUrl, source)
    || transport?.response !== response || transport?.checkedAt !== now.toISOString()
    || transport?.requestedUrl !== deal.url || match.id !== deal.id
    || !preservesKnownPeriod(deal, match, now)) return undefined;
  // Inactive templates cannot turn an old campaign into a current offer merely
  // because their unchanged text is still present in the downloaded HTML.
  const $ = load(response.html);
  $('template,[hidden],[aria-hidden="true"]').remove();
  $('[style]').filter((_, node) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(node).attr('style'))).remove();
  const visible = extractFoodOffers($.html(), source, { now, pageUrl: response.finalUrl }).deals
    .some(row => row.id === match.id && row.description === match.description
      && row.evidence.contentHash === match.evidence.contentHash);
  if (!visible) return undefined;
  return { method: 'current-official-landing-page-v1', checkedAt: now.toISOString(),
    sourceUrl: deal.url, finalUrl: response.finalUrl, offerId: match.id,
    contentHash: match.evidence.contentHash };
}

function couponTitleMatches(extracted, displayed) {
  const normalize = value => String(value).normalize('NFC').toLowerCase()
    .replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
  const original = normalize(extracted);
  const current = normalize(displayed);
  if (original === current) return true;
  // Permit only this lossless editorial inversion, not arbitrary paraphrases
  // or a caller's claim that its title has already been verified.
  const discount = original.match(/^(.+): (mehr als \d{1,2} % rabatt)$/);
  return Boolean(discount && current === `${discount[2]} auf ${discount[1]}`);
}

function reviewedKfcTitleMatches(extracted, deal, source) {
  // The queued legacy editor shortened this one source caption. Preserve the
  // separate description/brand/hash checks; this grants no date or venue proof.
  return source.name === 'KFC' && deal.url === 'https://kfc.co.at/'
    && deal.id === 'power-food-73cf88790a2d' && extracted.id === deal.id
    && extracted.title === 'Unser Preiskracher: Crispy Cheese Burger mit Käse, Gurkerl und Ketchup um 1,70 Euro'
    && deal.title === 'Crispy Cheese Burger für 1,70 Euro'
    && extracted.evidence.contentHash === 'fbcfc52691ccdb4bed424b086cb6b1830d52aabdd0bba3da2e31b75b4631576b';
}

export async function fetchOfficialFoodPage(url, source) {
  // Check every redirect before requesting it; a merchant must not redirect
  // this evidence verifier to an arbitrary host or a non-Austrian market.
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedFoodUrl(url, source))
      throw new Error("Untrusted official-food URL");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: {
        "user-agent": "FreeFinder/1.0 (+https://freefinder.at)",
        "accept-language": "de-AT,de;q=0.9",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw sourceHttpError(response.status, response.headers.get("retry-after"));
    }
    if (!/html/i.test(response.headers.get("content-type") || ""))
      throw new Error("Not HTML");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 2500000) {
        await reader.cancel();
        throw new Error("HTML limit");
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: url, status: response.status };
  }
  throw new Error("Redirect limit");
}

export async function verifyOfficialFoodDeal(deal, options = {}) {
  if (deal.originSource !== "power-official-food") return null;
  const source = POWER_FOOD_SOURCES.find(
    (s) =>
      (s.name === deal.source || s.name === deal.evidence?.merchantSourceKey) &&
      isAllowedFoodUrl(deal.url, s),
  );
  if (!source) return { ok: false, reason: "untrusted-merchant" };
  if (deal.evidence?.media && source.couponMedia !== 'moemax-reviewed-v1' && !options.couponMedia?.readAsset && process.env.COUPON_TOOLS_AVAILABLE === '0')
    return { ok: false, deferred: true, reason: 'coupon-tools-unavailable' };
  const cache = options.cache || new Map();
  const now = options.now || new Date();
  const key = source.name + "|" + deal.url;
  if (!currentFetches.has(cache)) currentFetches.set(cache, new Map());
  const fetches = currentFetches.get(cache);
  if (!cache.has(key))
    cache.set(
      key,
      (options.fetchPage || fetchOfficialFoodPage)(deal.url, source).then(response => {
        fetches.set(key, { response, requestedUrl: deal.url, checkedAt: now.toISOString() });
        return response;
      }).catch(
        (error) => ({ error: error.message }),
      ),
    );
  const response = await cache.get(key);
  if (response.error) return { ok: false, reason: "source-unavailable" };
  let parsed = extractFoodOffers(response.html, source, {
    now,
    pageUrl: response.finalUrl || deal.url,
  });
  if (deal.evidence?.media) {
    const mediaKey = key + '|media|' + deal.evidence.media.url;
    if (!cache.has(mediaKey)) cache.set(mediaKey, extractCouponMediaOffers(response.html,source,{
      now, pageUrl:response.finalUrl || deal.url,assetUrl:deal.evidence.media.url,
      ...(options.couponMedia || {}),
    }));
    parsed = await cache.get(mediaKey);
    const deferred = parsed.assets?.find(asset => asset.status === 'deferred');
    if (deferred) return { ok: false, deferred: true, reason: deferred.error };
  }
  // Re-extract from the current official page. A caller-supplied hash or
  // freshly stamped crawler date alone can never relax freshness checks.
  const match = parsed.deals.find(
    (d) =>
      d.description === deal.description &&
      (deal.evidence?.media ? couponTitleMatches(d.title, deal.title)
        : d.title === deal.title || reviewedKfcTitleMatches(d, deal, source)) &&
      d.brand === deal.brand &&
      d.evidence.contentHash === deal.evidence?.contentHash &&
      (!deal.evidence?.media || /^[a-f0-9]{64}$/.test(deal.evidence.media.cardSha256 || '')
        && d.evidence.media?.cardSha256 === deal.evidence.media.cardSha256
        && d.evidence.media?.index === deal.evidence.media.index
        // The generated PDF has a new CreationDate on every download. Compare
        // the freshly extracted coupon bytes, not only its container metadata.
        && (deal.evidence.media.kind === 'pdf' || d.evidence.media?.sha256 === deal.evidence.media.sha256)),
  );
  if (!match) return { ok: false, reason: "offer-not-on-current-page" };
  const timing = match.evidence.offerTiming;
  const current =
    source.currentOffers || Boolean(timing.validUntil || timing.recurring);
  let viennaBranchEvidence = "";
  if (source.currentOffers && source.branchEvidenceUrl) {
    const locationKey = source.name + "|" + source.branchEvidenceUrl;
    if (!cache.has(locationKey))
      cache.set(
        locationKey,
        (options.fetchPage || fetchOfficialFoodPage)(
          source.branchEvidenceUrl,
          source,
        ).catch((error) => ({ error: error.message })),
      );
    const locationResponse = await cache.get(locationKey);
    if (
      !locationResponse.error &&
      isAllowedFoodUrl(
        locationResponse.finalUrl || source.branchEvidenceUrl,
        source,
      )
    ) {
      const $ = load(locationResponse.html);
      $("script,style,noscript").remove();
      const text = $("body").text().replace(/\s+/g, " ");
      viennaBranchEvidence =
        text.match(
          /.{0,50}\b1(?:0[1-9]|1[0-9]|2[0-3])0\s+Wien\b.{0,60}|Filialen.{0,60}\bWien\b.{0,60}/i,
        )?.[0] || "";
    }
  }
  return {
    ok: true,
    current,
    currentOfferVerification: currentOfferVerification(deal, match, source, response, fetches.get(key), now),
    deal: match,
    viennaBranchEvidence,
    branchEvidenceUrl: source.branchEvidenceUrl || "",
  };
}
