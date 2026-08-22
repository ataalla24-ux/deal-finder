import assert from 'node:assert/strict';

import {
  classifyInstagramOcrWithOpenAI,
  enrichInstagramGraphMedia,
  extractInstagramMediaAssets,
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

let openAiRequest = null;
const ai = await classifyInstagramOcrWithOpenAI({
  caption: 'Unser Wochenplan',
  ocrText: 'Zweiter Kaffee gratis in 1070 Wien',
}, config, {
  fetchImpl: async (url, init) => {
    openAiRequest = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            isDeal: true,
            confidence: 0.94,
            offerText: 'Zweiter Kaffee gratis in 1070 Wien',
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
assert.equal(ai.isDeal, true);
assert.equal(ai.confidence, 0.94);

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
      assetCount: 1,
      imageCount: 1,
      videoFrameCount: 0,
      errors: [],
    };
  },
  classifyOcr: async () => {
    classifications += 1;
    return {
      isDeal: true,
      confidence: 0.93,
      offerText: 'Zweiter Kaffee gratis in 1070 Wien',
      exclusion: 'none',
    };
  },
});
assert.equal(analyses, 1, 'cached media must not be OCR-scanned again');
assert.equal(classifications, 1, 'caption-ambiguous OCR should receive one AI classification');
assert.equal(enriched.report.cached, 1);
assert.equal(enriched.report.analyzed, 1);
assert.equal(enriched.report.aiAccepted, 1);
assert.match(enriched.entries[0].item._mediaEvidence.ocrText, /zweiter Kaffee gratis/);

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

const noisyOcrFalsePositive = normalizeGraphMediaItem({
  id: 'noisy-ocr-1',
  caption: 'Ein Tag beim Festival in St. Poelten #vienna',
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
assert.equal(noisyOcrFalsePositive.deal, null, 'confident AI rejection must veto an OCR-only offer signal');
assert.equal(noisyOcrFalsePositive.rejection, 'media-ai-rejected-offer');

const staleCache = await enrichInstagramGraphMedia([], config, now, {
  tools: { tesseract: true, ffmpeg: true },
  cache: {
    stale: { analyzedAt: '2026-07-01T00:00:00.000Z', ocrText: 'old' },
  },
});
assert.equal(staleCache.cache.stale, undefined, 'expired OCR cache entries must be pruned');

console.log('instagram media evidence tests passed');
