import assert from 'node:assert/strict';

import {
  analyzeInstagramMediaItem,
  classifyInstagramOcrWithOpenAI,
  enrichInstagramGraphMedia,
  extractInstagramMediaAssets,
  selectMediaAssetsForAnalysis,
} from '../scraper/instagram-media-evidence.js';
import { buildConfig, normalizeGraphMediaItem } from '../scraper/meta-instagram-deals.js';

const now = new Date('2026-08-22T10:00:00.000Z');
const config = buildConfig({
  OPENAI_API_KEY: 'test-openai-key',
  META_INSTAGRAM_MEDIA_OCR_ENABLED: '1',
  META_INSTAGRAM_MEDIA_MAX_POSTS_PER_RUN: '5',
  META_INSTAGRAM_MEDIA_LLM_ENABLED: '1',
  META_INSTAGRAM_MEDIA_LLM_MAX_CALLS_PER_RUN: '3',
  META_INSTAGRAM_MEDIA_LLM_MIN_CONFIDENCE: '0.82',
}, now);

const assets = extractInstagramMediaAssets({
  id: 'carousel-1',
  media_type: 'CAROUSEL_ALBUM',
  media_url: 'https://cdn.example/cover.jpg',
  children: {
    data: [
      { media_type: 'IMAGE', media_url: 'https://cdn.example/slide-1.jpg' },
      {
        media_type: 'VIDEO',
        media_url: 'https://cdn.example/reel.mp4',
        thumbnail_url: 'https://cdn.example/reel.jpg',
      },
    ],
  },
});
assert.deepEqual(assets, [
  { type: 'image', url: 'https://cdn.example/slide-1.jpg' },
  { type: 'image', url: 'https://cdn.example/reel.jpg' },
  { type: 'video', url: 'https://cdn.example/reel.mp4' },
]);
assert.deepEqual(
  selectMediaAssetsForAnalysis([
    { type: 'image', url: 'https://cdn.example/slide-1.jpg' },
    { type: 'image', url: 'https://cdn.example/slide-2.jpg' },
    { type: 'image', url: 'https://cdn.example/slide-3.jpg' },
    { type: 'image', url: 'https://cdn.example/slide-4.jpg' },
    { type: 'image', url: 'https://cdn.example/slide-5.jpg' },
  ], 3).map((asset) => asset.url),
  [
    'https://cdn.example/slide-1.jpg',
    'https://cdn.example/slide-3.jpg',
    'https://cdn.example/slide-5.jpg',
  ],
  'carousel sampling must include the first, middle and final slide',
);

let openAiRequest = null;
const ai = await classifyInstagramOcrWithOpenAI({
  caption: 'Unser Wochenplan',
  ocrText: 'Zweiter Kaffee gratis in 1070 Wien',
  visionImages: ['data:image/jpeg;base64,AQID'],
}, config, {
  fetchImpl: async (url, init) => {
    openAiRequest = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      usage: { input_tokens: 321, output_tokens: 42, total_tokens: 363 },
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            isDeal: true,
            confidence: 0.94,
            offerText: 'Zweiter Kaffee gratis in 1070 Wien',
            locationText: '1070 Wien',
            validityText: '',
            exclusion: 'none',
          }),
        }],
      }],
    });
  },
});
assert.equal(openAiRequest.url, 'https://api.openai.com/v1/responses');
assert.equal(openAiRequest.init.headers.authorization, 'Bearer test-openai-key');
assert.equal(openAiRequest.body.store, false);
assert.equal(openAiRequest.body.text.format.type, 'json_schema');
assert.equal(openAiRequest.body.text.format.strict, true);
assert.match(openAiRequest.body.instructions, /publicly redeemable/i);
assert.ok(openAiRequest.body.text.format.schema.properties.exclusion.enum.includes('personal-compensation'));
assert.equal(openAiRequest.body.input[0].content[0].type, 'input_text');
assert.deepEqual(openAiRequest.body.input[0].content[1], {
  type: 'input_image',
  image_url: 'data:image/jpeg;base64,AQID',
  detail: 'high',
});
assert.equal(ai.isDeal, true);
assert.equal(ai.confidence, 0.94);
assert.equal(ai.locationText, '1070 Wien');
assert.deepEqual(ai.usage, { inputTokens: 321, outputTokens: 42, totalTokens: 363 });

const entries = [{
  item: {
    id: 'media-new',
    caption: 'Unser neuer Wochenplan',
    media_type: 'IMAGE',
    media_url: 'https://cdn.example/new.jpg',
    timestamp: '2026-08-22T09:00:00.000Z',
  },
  context: { account: { username: 'wiencafe', verifiedVienna: true } },
}, {
  item: {
    id: 'media-cached',
    caption: 'Schon analysiert',
    media_type: 'IMAGE',
    media_url: 'https://cdn.example/cached.jpg',
    timestamp: '2026-08-22T08:00:00.000Z',
  },
  context: { account: { username: 'wienbar', verifiedVienna: true } },
}];

let analyses = 0;
let classifications = 0;
let classificationInput = null;
const enriched = await enrichInstagramGraphMedia(entries, config, now, {
  tools: { tesseract: true, ffmpeg: true },
  cache: {
    'media-cached': {
      analyzedAt: '2026-08-22T08:30:00.000Z',
      ocrText: 'Happy Hour: 2 Cocktails zum Preis von 1',
      assetCount: 1,
      imageCount: 1,
      videoFrameCount: 0,
      errors: [],
    },
  },
  analyzeItem: async () => {
    analyses += 1;
    return {
      ocrText: 'Nur am 24.08.: zweiter Kaffee gratis in 1070 Wien',
      visionImages: ['data:image/jpeg;base64,AQID'],
      assetCount: 1,
      imageCount: 1,
      videoFrameCount: 0,
      errors: [],
    };
  },
  classifyOcr: async (input) => {
    classifications += 1;
    classificationInput = input;
    return {
      isDeal: true,
      confidence: 0.93,
      offerText: 'Zweiter Kaffee gratis in 1070 Wien',
      exclusion: 'none',
      usage: { inputTokens: 200, outputTokens: 30, totalTokens: 230 },
    };
  },
});
assert.equal(analyses, 1, 'cached media must not be OCR-scanned again');
assert.equal(classifications, 1, 'caption-ambiguous OCR should receive one AI classification');
assert.equal(enriched.report.cached, 1);
assert.equal(enriched.report.analyzed, 1);
assert.equal(enriched.report.aiAccepted, 1);
assert.equal(enriched.report.withVisionImages, 1);
assert.equal(enriched.report.visionCalls, 1);
assert.equal(enriched.report.inputTokens, 200);
assert.equal(enriched.report.outputTokens, 30);
assert.equal(enriched.report.totalTokens, 230);
assert.equal(classificationInput.visionImages.length, 1);
assert.match(enriched.entries[0].item._mediaEvidence.ocrText, /zweiter Kaffee gratis/);
assert.equal(enriched.entries[0].item._mediaEvidence.visionImageCount, 1);
assert.equal('visionImages' in enriched.entries[0].item._mediaEvidence, false, 'raw image data must not be persisted in evidence');

let activeClassifications = 0;
let peakClassifications = 0;
const concurrentEntries = Array.from({ length: 3 }, (_, index) => ({
  item: {
    id: `concurrent-${index}`,
    caption: 'Neues Kaffee-Special in Wien',
    media_type: 'IMAGE',
    media_url: `https://cdn.example/concurrent-${index}.jpg`,
    timestamp: '2026-08-22T09:30:00.000Z',
  },
  context: { account: { username: `cafe-${index}.wien`, verifiedVienna: true, category: 'food' } },
}));
const concurrent = await enrichInstagramGraphMedia(concurrentEntries, config, now, {
  tools: { tesseract: true, ffmpeg: false },
  analyzeItem: async () => ({
    ocrText: 'Zweiter Kaffee gratis',
    visionImages: [],
    assetCount: 1,
    imageCount: 1,
    videoFrameCount: 0,
    errors: [],
  }),
  classifyOcr: async () => {
    activeClassifications += 1;
    peakClassifications = Math.max(peakClassifications, activeClassifications);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeClassifications -= 1;
    return { isDeal: true, confidence: 0.95, offerText: 'Zweiter Kaffee gratis', exclusion: 'none' };
  },
});
assert.equal(concurrent.report.aiConcurrency, 2);
assert.equal(concurrent.report.aiCalls, 3);
assert.equal(peakClassifications, 2, 'media classifications should use the configured bounded concurrency');

let visionOnlyClassifications = 0;
const visionOnly = await enrichInstagramGraphMedia([{
  item: {
    id: 'vision-only',
    caption: '20 % Rabatt auf Kaffee',
    media_type: 'IMAGE',
    media_url: 'https://cdn.example/vision-only.jpg',
    timestamp: '2026-08-22T09:30:00.000Z',
  },
  context: { sourceType: 'hashtag', sourceName: '#wienessen' },
}], config, now, {
  tools: { tesseract: false, ffmpeg: true },
  analyzeItem: async () => ({
    ocrText: '',
    visionImages: ['data:image/jpeg;base64,AQID'],
    assetCount: 1,
    imageCount: 1,
    videoFrameCount: 0,
    errors: [],
  }),
  classifyOcr: async () => {
    visionOnlyClassifications += 1;
    return {
      isDeal: true,
      confidence: 0.95,
      offerText: '20 % Rabatt auf Kaffee',
      locationText: '1070 Wien',
      validityText: 'Gültig bis 30.08.2026',
      exclusion: 'none',
    };
  },
});
assert.equal(visionOnlyClassifications, 1, 'Vision keeps media classification running when Tesseract is unavailable');
assert.equal(visionOnly.report.ocrAvailable, false);
assert.equal(visionOnly.report.visionCalls, 1);
assert.equal(visionOnly.report.status, 'ok');

const imageOnlyDeal = normalizeGraphMediaItem({
  id: 'image-only-1',
  caption: 'Unser neuer Wochenplan',
  permalink: 'https://www.instagram.com/p/IMAGEONLY1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'wiencafe',
  _mediaEvidence: enriched.entries[0].item._mediaEvidence,
}, {
  sourceType: 'account',
  sourceName: '@wiencafe',
  account: { username: 'wiencafe', verifiedVienna: true },
}, config, now);
assert.ok(imageOnlyDeal.deal, 'an image-only deal must survive normalization');
assert.match(imageOnlyDeal.deal.description, /Bildtext:/);
assert.equal(imageOnlyDeal.deal.evidence.mediaEvidence.ai.isDeal, true);
assert.equal(imageOnlyDeal.deal.pubDateSource, 'instagram-graph-timestamp');

const visionDiscoveredDeal = normalizeGraphMediaItem({
  id: 'vision-location-1',
  caption: 'Unser Wochenplan',
  permalink: 'https://www.instagram.com/p/VISIONLOCATION1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'new.visual.cafe',
  _mediaEvidence: {
    ocrText: '',
    visionImageCount: 1,
    ai: {
      isDeal: true,
      confidence: 0.95,
      offerText: '20 % Rabatt auf Kaffee',
      locationText: 'Neubaugasse 12, 1070 Wien',
      validityText: 'Gültig bis 30.08.2026',
      exclusion: 'none',
    },
  },
}, {
  sourceType: 'hashtag',
  sourceName: '#wienessen',
}, config, now);
assert.ok(visionDiscoveredDeal.deal, 'visible Vision location evidence can verify a new hashtag merchant');
assert.equal(visionDiscoveredDeal.deal.title, '20 % Rabatt auf Kaffee');
assert.equal(visionDiscoveredDeal.deal.validUntil, '2026-08-30T23:59:59.999Z');
assert.equal(visionDiscoveredDeal.deal.evidence.mediaEvidence.ai.locationText, 'Neubaugasse 12, 1070 Wien');

const noisyOcrFalsePositive = normalizeGraphMediaItem({
  id: 'noisy-ocr-1',
  caption: 'Ein Tag beim Frequency Festival #vienna',
  permalink: 'https://www.instagram.com/reel/NOISYOCR1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'wiencreator',
  _mediaEvidence: {
    ocrText: 'FR a make 7% ReeEEREQUENCY FESTIVAL',
    assetCount: 2,
    imageCount: 1,
    videoFrameCount: 4,
    ai: {
      isDeal: false,
      confidence: 0.9,
      offerText: '',
      exclusion: 'generic-content',
    },
  },
}, {
  sourceType: 'account',
  sourceName: '@wiencreator',
  account: { username: 'wiencreator', verifiedVienna: true },
}, config, now);
assert.equal(noisyOcrFalsePositive.deal, null, 'noisy OCR must not create an offer');
assert.equal(
  noisyOcrFalsePositive.rejection,
  'no-concrete-offer',
  'a bare OCR percentage without Rabatt/auf/off is rejected before the AI veto is needed',
);

const splitEvidenceFalsePositive = normalizeGraphMediaItem({
  id: 'split-evidence-1',
  caption: 'We are getting ready for something special this Friday, 28.08, in 1060 Vienna.',
  permalink: 'https://www.instagram.com/reel/SPLITEVIDENCE1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'creative.vienna',
  _mediaEvidence: {
    ocrText: 'FRI 28.8 SUMMER STORY 2% FAMILY',
    assetCount: 2,
    imageCount: 1,
    videoFrameCount: 4,
  },
}, {
  sourceType: 'account',
  sourceName: '@creative.vienna',
  account: { username: 'creative.vienna', verifiedVienna: true },
}, config, now);
assert.equal(splitEvidenceFalsePositive.deal, null, 'soft caption copy and unrelated OCR numbers cannot combine into a deal');
assert.equal(splitEvidenceFalsePositive.rejection, 'media-ai-required-for-combined-offer');

const unclassifiedOcrFalsePositive = normalizeGraphMediaItem({
  id: 'unclassified-ocr-1',
  caption: 'Kommt vorbei in 1100 Wien und genießt unsere frisch panierten Schnitzel.',
  permalink: 'https://www.instagram.com/reel/UNCLASSIFIEDOCR1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  _mediaEvidence: {
    ocrText: 'N AS ek SR 5 Bene Tre FREE Sorter',
    visionImageCount: 1,
  },
}, {
  sourceType: 'hashtag',
  sourceName: '#viennaeats',
}, config, now);
assert.equal(unclassifiedOcrFalsePositive.deal, null, 'unclassified OCR must never rescue a caption-only rejection');
assert.equal(unclassifiedOcrFalsePositive.rejection, 'media-ai-required-for-ocr-offer');

const selfSyndicatedDeal = normalizeGraphMediaItem({
  id: 'self-syndicated-1',
  caption: 'Gratis Drink testen. Alle aktuellen Bedingungen und den Original-Link findest du direkt in FreeFinder. #freefinder #wien',
  permalink: 'https://www.instagram.com/reel/SELFSYNDICATED1/',
  timestamp: '2026-08-22T09:00:00.000Z',
}, {
  sourceType: 'hashtag',
  sourceName: '#gratiswien',
}, config, now);
assert.equal(selfSyndicatedDeal.deal, null, 'FreeFinder syndication must not feed back into discovery');
assert.equal(selfSyndicatedDeal.rejection, 'self-syndicated-deal');

const outsideViennaDeal = normalizeGraphMediaItem({
  id: 'outside-vienna-1',
  caption: '20% Rabatt beim Festival in St. Poelten #vienna',
  permalink: 'https://www.instagram.com/reel/OUTSIDEVIENNA1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'wiencreator',
}, {
  sourceType: 'account',
  sourceName: '@wiencreator',
  account: { username: 'wiencreator', verifiedVienna: true },
}, config, now);
assert.equal(outsideViennaDeal.deal, null, 'an explicit non-Vienna location must override a hashtag and account hint');
assert.equal(outsideViennaDeal.rejection, 'non-vienna-location');

const multiCityDeal = normalizeGraphMediaItem({
  id: 'multi-city-1',
  caption: '20% Rabatt in Graz und Wien am 24. August',
  permalink: 'https://www.instagram.com/p/MULTICITY1/',
  timestamp: '2026-08-22T09:00:00.000Z',
  username: 'austriadeals',
}, {
  sourceType: 'account',
  sourceName: '@austriadeals',
  account: { username: 'austriadeals', verifiedVienna: false },
}, config, now);
assert.ok(multiCityDeal.deal, 'a multi-city offer that explicitly includes Vienna must remain eligible');

const imageResponse = () => new Response(Uint8Array.from([1, 2, 3]), {
  headers: { 'content-type': 'image/jpeg' },
});
let failedOcrCalls = 0;
const failedOcr = await analyzeInstagramMediaItem({
  media_type: 'IMAGE',
  media_url: 'https://cdn.example/broken.jpg',
}, config, {
  tools: { tesseract: true, ffmpeg: false },
  fetchImpl: async () => imageResponse(),
  execFileImpl: async () => {
    failedOcrCalls += 1;
    const error = new Error('Command failed: tesseract');
    error.stderr = 'Error in pixReadMem';
    throw error;
  },
});
assert.equal(failedOcrCalls, 1, 'non-language OCR failures must not be retried');
assert.equal(failedOcr.errors.length, 0, 'a per-image OCR failure is not a pipeline error when the asset was downloaded');
assert.equal(failedOcr.warnings.length, 1, 'a per-image OCR failure remains visible as a warning');
assert.equal(failedOcr.visionImages.length, 1, 'a failed OCR pass still leaves visual evidence for the model');

let languageFallbackCalls = 0;
const languageFallback = await analyzeInstagramMediaItem({
  media_type: 'IMAGE',
  media_url: 'https://cdn.example/language-fallback.jpg',
}, config, {
  tools: { tesseract: true, ffmpeg: false },
  fetchImpl: async () => imageResponse(),
  execFileImpl: async () => {
    languageFallbackCalls += 1;
    if (languageFallbackCalls === 1) {
      const error = new Error('Command failed: tesseract');
      error.stderr = "Error opening data file deu.traineddata. Failed loading language 'deu'. Could not initialize tesseract.";
      throw error;
    }
    return { stdout: 'Zweiter Kaffee gratis in Wien' };
  },
});
assert.equal(languageFallbackCalls, 2, 'missing language data should retry with the default OCR language');
assert.match(languageFallback.ocrText, /Kaffee gratis/);

let mediaFetchAttempts = 0;
const recovered403 = await analyzeInstagramMediaItem({
  media_type: 'IMAGE',
  media_url: 'https://cdn.example/temporary-403.jpg',
  permalink: 'https://www.instagram.com/p/TEMP403/',
}, config, {
  tools: { tesseract: false, ffmpeg: false, ffprobe: false },
  fetchImpl: async () => {
    mediaFetchAttempts += 1;
    if (mediaFetchAttempts < 3) return new Response('', { status: 403 });
    return imageResponse();
  },
});
assert.equal(mediaFetchAttempts, 3, 'temporary media 403s should use alternate request profiles');
assert.equal(recovered403.assetCount, 1);
assert.equal(recovered403.downloadRetries, 2);
assert.equal(recovered403.errors.length, 0);

let retriedCacheAnalyses = 0;
const retriedCache = await enrichInstagramGraphMedia([{
  item: {
    id: 'retry-cached-403',
    caption: '20 % Rabatt auf Burger in Wien',
    media_type: 'IMAGE',
    media_url: 'https://cdn.example/retry.jpg',
    timestamp: '2026-08-22T09:30:00.000Z',
  },
  context: { account: { username: 'burger.wien', verifiedVienna: true, category: 'food' } },
}], config, now, {
  tools: { tesseract: true, ffmpeg: false, ffprobe: false },
  cache: {
    'retry-cached-403': {
      analyzedAt: '2026-08-22T09:35:00.000Z',
      assetCount: 0,
      errors: ['media HTTP 403 after 3 attempts'],
    },
  },
  analyzeItem: async () => {
    retriedCacheAnalyses += 1;
    return {
      ocrText: '20 % Rabatt auf Burger in 1070 Wien',
      visionImages: [],
      assetCount: 1,
      availableAssetCount: 1,
      imageCount: 1,
      videoFrameCount: 0,
      downloadAttempts: 1,
      downloadRetries: 0,
      errors: [],
      warnings: [],
    };
  },
});
assert.equal(retriedCacheAnalyses, 1, 'a cached transient 403 must be analyzed again');
assert.equal(retriedCache.report.retriedCacheEntries, 1);
assert.equal(retriedCache.report.retryableFailures, 0);

const staleCache = await enrichInstagramGraphMedia([], config, now, {
  tools: { tesseract: true, ffmpeg: true },
  cache: {
    stale: { analyzedAt: '2026-07-01T00:00:00.000Z', ocrText: 'old' },
  },
});
assert.equal(staleCache.cache.stale, undefined, 'expired OCR cache entries must be pruned');

console.log('instagram media evidence tests passed');
