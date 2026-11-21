import {
  extractFoodOffers,
  discoverFoodLinks,
} from "./power-food-extraction.js";
import { isAllowedFoodUrl } from "./power-food-sources.js";
import { sourceFailureFields } from "./source-http-policy.js";
import { readCashbackListing, retainedCashbackRows, rotateCashbackLinks } from './power-marktguru-cashback.js';
import { extractCouponMediaOffers } from './official-coupon-media.js';

export async function crawlFoodSource(source, options) {
  const now = options.now || new Date();
  const started = Date.now();
  const maxPages = Math.max(1, Math.min(8, source.maxPages || 8, options.maxPages || 5));
  const queue = [source.url, ...(source.seeds || [])];
  const seen = new Set();
  const pages = [];
  const deferredPages = [];
  const candidates = [];
  const rejected = [];
  let listedCashback = new Map();
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift();
    if (seen.has(url) || !isAllowedFoodUrl(url, source)) continue;
    seen.add(url);
    const pageRetryAt = options.pageCooldowns?.[url]?.nextRetryAt;
    if (url !== source.url && Date.parse(pageRetryAt) > +now) {
      deferredPages.push({ url, retryAt: pageRetryAt });
      continue;
    }
    try {
      let response = await options.fetchPage(url);
      if (!isAllowedFoodUrl(response.finalUrl || url, source) || (source.cashbackCampaigns && response.finalUrl !== url))
        throw new Error("foreign-redirect");
      seen.add(response.finalUrl || url);
      if (
        source.render === true || (/enable javascript|javascript.{0,20}(?:required|aktivieren)/i.test(
          response.html,
        ) &&
        response.html.length < 30000)
      ) {
        if (options.renderPage && !source.cashbackCampaigns) response = await options.renderPage(url);
        else {
          pages.push({ url, status: "needs-browser", candidates: 0 });
          continue;
        }
      }
      if (!isAllowedFoodUrl(response.finalUrl || url, source))
        throw new Error("foreign-redirect");
      const parsed = extractFoodOffers(response.html, source, {
        now,
        pageUrl: response.finalUrl || url,
      });
      candidates.push(...parsed.deals);
      rejected.push(...parsed.rejected);
      const media = source.couponMedia ? await extractCouponMediaOffers(response.html,source,{
        now, pageUrl:response.finalUrl || url,
        ...(options.couponMedia || {}),
      }) : null;
      if (media) {
        candidates.push(...media.deals);
        rejected.push(...media.rejected);
      }
      const mediaFailed = media?.assets.filter(a=>a.status==='error') || [];
      const mediaDeferred = media?.assets.filter(a=>a.status==='deferred') || [];
      pages.push({
        url,
        finalUrl: response.finalUrl || url,
        status: mediaFailed.length ? 'error' : mediaDeferred.length ? 'needs-review' : 'ok',
        candidates: parsed.deals.length + (media?.deals.length || 0),
        bytes: response.bytes || response.html.length,
        ...(media ? {media:media.assets} : {}),
        ...(mediaFailed.length ? {error:mediaFailed.map(a=>a.error).join('; '),
          httpStatus:mediaFailed[0].httpStatus,retryAt:mediaFailed[0].retryAt} : {}),
        ...(!mediaFailed.length && mediaDeferred.length ? {error:mediaDeferred.map(a=>a.error).join('; ')} : {}),
      });
      if (mediaFailed.some(a=>/HTTP (401|403|429)/.test(a.error))) break;
      let links;
      if (source.cashbackCampaigns) {
        if (url === source.url && response.status === 200) {
          listedCashback = readCashbackListing(response.html, url);
          links = rotateCashbackLinks(listedCashback, source.previousDetailUrl);
        } else links = [];
      } else {
        links = discoverFoodLinks(response.html, source, response.finalUrl || url, maxPages * 2);
      }
      for (const link of links.slice(0, maxPages * 2)) {
        if (!seen.has(link) && !queue.includes(link)) queue.push(link);
      }
    } catch (error) {
      pages.push({
        url,
        status: /429/.test(error.message) ? "rate-limited" : "error",
        candidates: 0,
        error: error.message,
        ...sourceFailureFields(error),
      });
      // Do not retry a blocked merchant through another transport or page.
      if ([401, 403, 429].includes(sourceFailureFields(error).httpStatus)) break;
    }
  }
  const byOffer = new Map();
  for (const d of candidates) {
    const key = d.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const prev = byOffer.get(key);
    if (!prev || d.description.length > prev.description.length)
      byOffer.set(key, d);
  }
  let rows = [...byOffer.values()]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, options.maxDeals || 25);
  const failed = pages.filter((p) => p.status !== "ok");
  const verifiedCount = rows.length;
  if (source.cashbackCampaigns && !failed.length) {
    const excluded = new Set([...seen, ...Object.entries(options.pageCooldowns || {})
      .filter(([, pause]) => Date.parse(pause.nextRetryAt) > +now).map(([url]) => url)]);
    const retained = retainedCashbackRows(options.previousCashbackRows, listedCashback, excluded, now);
    rows = [...rows, ...retained.filter(row => !rows.some(fresh => fresh.id === row.id))]
      .slice(0, Math.min(10, options.maxDeals || 10));
  }
  return {
    source: source.name,
    url: source.url,
    status: failed.length === pages.length ? "error" : "ok",
    operationalStatus: failed.some((p) => p.status === "rate-limited")
      ? "rate-limited"
      : failed.length
        ? "degraded"
        : rows.length
          ? "candidates-found"
          : "no-offers",
    deals: rows.length,
    ...(source.cashbackCampaigns ? { cashbackDetailsVerified: verifiedCount, cashbackDetailsRetained: rows.length - verifiedCount } : {}),
    rows,
    pages,
    ...(deferredPages.length ? { deferredPages } : {}),
    rejected,
    rejectedCount: rejected.length,
    sourceKind: "official-food",
    durationMs: Date.now() - started,
    ...(failed.length
      ? { error: failed.map((p) => p.error || p.status).join("; ") }
      : {}),
  };
}
