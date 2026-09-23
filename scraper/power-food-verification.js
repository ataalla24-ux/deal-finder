import { load } from "cheerio";
import { POWER_FOOD_SOURCES, isAllowedFoodUrl } from "./power-food-sources.js";
import { extractFoodOffers } from "./power-food-extraction.js";

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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: url };
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
  const cache = options.cache || new Map();
  const key = source.name + "|" + deal.url;
  if (!cache.has(key))
    cache.set(
      key,
      (options.fetchPage || fetchOfficialFoodPage)(deal.url, source).catch(
        (error) => ({ error: error.message }),
      ),
    );
  const response = await cache.get(key);
  if (response.error) return { ok: false, reason: "source-unavailable" };
  const now = options.now || new Date();
  const parsed = extractFoodOffers(response.html, source, {
    now,
    pageUrl: response.finalUrl || deal.url,
  });
  // Re-extract from the current official page. A caller-supplied hash or
  // freshly stamped crawler date alone can never relax freshness checks.
  const match = parsed.deals.find(
    (d) =>
      d.description === deal.description &&
      d.title === deal.title &&
      d.brand === deal.brand &&
      d.evidence.contentHash === deal.evidence?.contentHash,
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
    deal: match,
    viennaBranchEvidence,
    branchEvidenceUrl: source.branchEvidenceUrl || "",
  };
}
