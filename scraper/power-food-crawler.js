import {
  extractFoodOffers,
  discoverFoodLinks,
} from "./power-food-extraction.js";
import { isAllowedFoodUrl } from "./power-food-sources.js";

export async function crawlFoodSource(source, options) {
  const now = options.now || new Date();
  const started = Date.now();
  const maxPages = Math.max(1, Math.min(8, options.maxPages || 5));
  const queue = [source.url, ...(source.seeds || [])];
  const seen = new Set();
  const pages = [];
  const candidates = [];
  const rejected = [];
  while (queue.length && seen.size < maxPages) {
    const url = queue.shift();
    if (seen.has(url) || !isAllowedFoodUrl(url, source)) continue;
    seen.add(url);
    try {
      let response = await options.fetchPage(url);
      if (!isAllowedFoodUrl(response.finalUrl || url, source))
        throw new Error("foreign-redirect");
      if (
        /enable javascript|javascript.{0,20}(?:required|aktivieren)/i.test(
          response.html,
        ) &&
        response.html.length < 30000
      ) {
        if (options.renderPage) response = await options.renderPage(url);
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
      pages.push({
        url,
        finalUrl: response.finalUrl || url,
        status: "ok",
        candidates: parsed.deals.length,
        bytes: response.bytes || response.html.length,
      });
      for (const link of discoverFoodLinks(
        response.html,
        source,
        response.finalUrl || url,
        maxPages * 2,
      ))
        if (!seen.has(link) && !queue.includes(link)) queue.push(link);
    } catch (error) {
      pages.push({
        url,
        status: /429/.test(error.message) ? "rate-limited" : "error",
        candidates: 0,
        error: error.message,
      });
      // Do not retry a rate-limited merchant through another transport or page.
      if (/429/.test(error.message)) break;
    }
  }
  const byOffer = new Map();
  for (const d of candidates) {
    const key = d.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const prev = byOffer.get(key);
    if (!prev || d.description.length > prev.description.length)
      byOffer.set(key, d);
  }
  const rows = [...byOffer.values()]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, options.maxDeals || 25);
  const failed = pages.filter((p) => p.status !== "ok");
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
    rows,
    pages,
    rejected,
    rejectedCount: rejected.length,
    sourceKind: "official-food",
    durationMs: Date.now() - started,
    ...(failed.length
      ? { error: failed.map((p) => p.error || p.status).join("; ") }
      : {}),
  };
}
