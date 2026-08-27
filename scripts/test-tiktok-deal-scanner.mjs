import assert from 'node:assert/strict';

import {
  buildDealFromPost,
  rescueTikTokMediaCandidates,
} from '../scraper/tiktok-deals-scanner.js';

const REFERENCE_NOW = new Date('2026-08-26T12:00:00.000Z');

function containsLoneSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function postData(description, accountHandle = 'vienna.deals', ageHours = 1) {
  return {
    accountHandle,
    title: description,
    description,
    bodyText: `${description} Creator bio: Vienna tips and free events.`,
    timeDateTime: new Date(REFERENCE_NOW.getTime() - ageHours * 60 * 60 * 1000).toISOString(),
    jsonLdUploadDate: '',
    jsonLdDatePublished: '',
    createTimes: [],
  };
}

function build(url, data) {
  return buildDealFromPost(url, data, { now: REFERENCE_NOW });
}

const validMatcha = build(
  'https://www.tiktok.com/@laserglow_vienna/video/7676841760328371478',
  postData('Gratis Matcha bei Laser Glow, Kaiserstraße 105, 1070 Wien.', 'laserglow_vienna'),
);
assert.ok(validMatcha.deal);
assert.match(validMatcha.deal.title, /Gratis Matcha/);

const creatorPostWithNamedProvider = build(
  'https://www.tiktok.com/@kseniainvienna/video/7678002441849425155',
  postData(
    'Vienna Dyson Styling Tour Pop-Up. @Dyson DACH: get your hair styled, win free goodies and enjoy free drinks. 26 - 29 August 2026, Rathausplatz, 1010 Wien.',
    'kseniainvienna',
  ),
);
assert.ok(creatorPostWithNamedProvider.deal);
assert.equal(creatorPostWithNamedProvider.deal.brand, 'Dyson');
assert.equal(creatorPostWithNamedProvider.deal.title, 'Gratis Haarstyling und Drinks beim Dyson Pop-up');
assert.equal(creatorPostWithNamedProvider.deal.category, 'beauty');
assert.equal(creatorPostWithNamedProvider.deal.validFrom, '2026-08-26');
assert.equal(creatorPostWithNamedProvider.deal.validUntil, '2026-08-29');
assert.equal(creatorPostWithNamedProvider.deal.postalCode, '1010');
assert.equal(creatorPostWithNamedProvider.deal.distance, '1010 Wien');

const foreignViennaHandle = build(
  'https://www.tiktok.com/@twofatpanda.vienna/video/7676699636131761415',
  postData('Free treats every weekend at Two Fat Panda Vienna, Gading Serpong, Indonesia.', 'twofatpanda.vienna'),
);
assert.equal(foreignViennaHandle.deal, null);
assert.match(foreignViennaHandle.reason, /Wien-Signal/);

const losAngelesKeywordLeak = build(
  'https://www.tiktok.com/@weimpactla/video/7676331690842705183',
  postData('FREE FOOD GIVEAWAY at 1010 E. 10th Street, Los Angeles, CA. Free and open to the community.', 'weimpactla'),
);
assert.equal(losAngelesKeywordLeak.deal, null);
assert.match(losAngelesKeywordLeak.reason, /Wien-Signal/);

const verifiedProfileContext = postData(
  'Sichere dir dein kostenloses Probetraining mit Coach Isa. #BoxenWien',
  'datriboxing',
);
verifiedProfileContext.bodyText = `${verifiedProfileContext.description} Creator bio: Boxclub und Training in Vienna.`;
const validProfileContext = build(
  'https://www.tiktok.com/@datriboxing/video/7676026132944276758',
  verifiedProfileContext,
);
assert.ok(validProfileContext.deal);
assert.equal(validProfileContext.deal.viennaEvidence.source, 'tiktok-post');
assert.match(validProfileContext.deal.viennaEvidence.detail, /Vienna/i);

const bioMustNotCreateOffer = build(
  'https://www.tiktok.com/@lara_kristiin/video/7676529485998656790',
  postData('Dieses Wochenende findet der Neustifter Kirtag in Wien mit Essen und Musik statt.', 'lara_kristiin'),
);
assert.equal(bioMustNotCreateOffer.deal, null);
assert.match(bioMustNotCreateOffer.reason, /Deal-Signal/);

const genericFreeListing = build(
  'https://www.tiktok.com/@creator/video/7674945375526030624',
  postData('I love the amount of free events happening all the time in Vienna: concerts, festivals and activities.', 'creator'),
);
assert.equal(genericFreeListing.deal, null);
assert.match(genericFreeListing.reason, /Deal-Signal/);

const genericTravelGuide = build(
  'https://www.tiktok.com/@laura.the.explore70/video/7678002441849425156',
  postData(
    'Saving the best of Vienna for your travel bucket list! From free hidden gems to iconic architecture. Save this post for your itinerary!',
    'laura.the.explore70',
  ),
);
assert.equal(genericTravelGuide.deal, null);
assert.match(genericTravelGuide.reason, /Reiseguide/);

const freePublicInfrastructure = build(
  'https://www.tiktok.com/@orfradiowienheute/video/7678002441849425157',
  postData('In fünf Wiener Parks gibt es ab sofort kostenlose Ladestationen für Smartphones und Tablets.', 'orfradiowienheute'),
);
assert.equal(freePublicInfrastructure.deal, null);
assert.match(freePublicInfrastructure.reason, /Infrastruktur/);

const customerParking = build(
  'https://www.tiktok.com/@megamarkt/video/7678002441849425158',
  postData('MEGA SUPERMARKT, Handelskai 216, 1020 Wien: Gratis Kundenparkplatz.', 'megamarkt'),
);
assert.equal(customerParking.deal, null);
assert.match(customerParking.reason, /Infrastruktur/);

const publicDrinkingWater = build(
  'https://www.tiktok.com/@wienmermaid/video/7678002441849425180',
  postData(
    'High-quality drinking water is available for free at public drinking-water fountains and water stations throughout Vienna.',
    'wienmermaid',
  ),
);
assert.equal(publicDrinkingWater.deal, null);
assert.match(publicDrinkingWater.reason, /Infrastruktur/);

const freePissoir = build(
  'https://www.tiktok.com/@orfradiowienheute/video/7678002441849425181',
  postData('Männer gehen gratis aufs Pissoir, Frauen müssen für das Klo 50 Cent zahlen. #wien', 'orfradiowienheute'),
);
assert.equal(freePissoir.deal, null);
assert.match(freePissoir.reason, /Infrastruktur/);

const selfSyndicatedTikTok = build(
  'https://www.tiktok.com/@freefinder.at/video/7678002441849425182',
  postData('Gratis Iced Matcha Latte in Wien bis 01. September bei OMV.', 'freefinder.at'),
);
assert.equal(selfSyndicatedTikTok.deal, null);
assert.match(selfSyndicatedTikTok.reason, /Eigenpost/);

const datriTrial = build(
  'https://www.tiktok.com/@datriboxing/video/7678002441849425159',
  postData(
    'So könnte dein Training bei DATRI BOXING aussehen. Schreib uns eine DM und sichere dir dein kostenloses Probetraining mit Isa! #BoxenWien',
    'datriboxing',
  ),
);
assert.ok(datriTrial.deal);
assert.equal(datriTrial.deal.brand, 'Datri Boxing');
assert.equal(datriTrial.deal.title, 'Gratis Probetraining bei Datri Boxing');

const weekdayBridgedRange = build(
  'https://www.tiktok.com/@chocoberry/video/7678002441849425160',
  postData(
    '1+1 GRATIS BEI CHOCOBERRY! Nur für kurze Zeit: Montag, 24.08. bis Mittwoch, 26.08. Kauf 1 Becher und erhalte den 2. gratis. Copa Beach Wien.',
    'chocoberry',
    48,
  ),
);
assert.ok(weekdayBridgedRange.deal);
assert.equal(weekdayBridgedRange.deal.validFrom, '2026-08-24');
assert.equal(weekdayBridgedRange.deal.validUntil, '2026-08-26');
assert.equal(weekdayBridgedRange.deal.category, 'essen');

const expiredWeekdayBridgedRange = buildDealFromPost(
  'https://www.tiktok.com/@chocoberry/video/7678002441849425183',
  postData(
    '1+1 GRATIS BEI CHOCOBERRY! HEUTE, Montag, 24.08. bis Mittwoch, 26.08. Kauf 1 Becher und erhalte den 2. gratis. Copa Beach Wien.',
    'chocoberry',
    48,
  ),
  { now: new Date('2026-08-27T12:00:00.000Z') },
);
assert.equal(expiredWeekdayBridgedRange.deal, null);
assert.match(expiredWeekdayBridgedRange.reason, /abgelaufen/);

const cafeMilano = build(
  'https://www.tiktok.com/@iamlicette/video/7678002441849425161',
  postData(
    'Cafe Milano has Happy Hour every single day from 5 PM to 10 PM, and you can play pool for absolutely free. Vienna, Austria.',
    'iamlicette',
  ),
);
assert.ok(cafeMilano.deal);
assert.equal(cafeMilano.deal.brand, 'Cafe Milano');
assert.equal(cafeMilano.deal.title, 'Tägliche Happy Hour und gratis Billard bei Cafe Milano');

const palaceOfJustice = build(
  'https://www.tiktok.com/@beingsarakay/video/7678002441849425162',
  postData(
    'The Palace of Justice is completely free to enter. Open from 9:30 AM to 2:30 PM. Vienna, Austria.',
    'beingsarakay',
  ),
);
assert.ok(palaceOfJustice.deal);
assert.equal(palaceOfJustice.deal.brand, 'Palace of Justice Vienna');
assert.equal(palaceOfJustice.deal.title, 'Gratis Eintritt im Justizpalast Wien');

const wukConcerts = build(
  'https://www.tiktok.com/@goodnight.at_wien/video/7678002441849425163',
  postData(
    'Im @wukvienna gibt es im August gratis Open-Air-Konzerte. Bis 27. August, Währinger Straße 59, 1090 Wien.',
    'goodnight.at_wien',
  ),
);
assert.ok(wukConcerts.deal);
assert.equal(wukConcerts.deal.brand, 'WUK Wien');
assert.equal(wukConcerts.deal.title, 'Gratis Open-Air-Konzerte beim WUK');
assert.equal(wukConcerts.deal.validUntil, '2026-08-27');

const crossYearFreshPost = buildDealFromPost(
  'https://www.tiktok.com/@newyear.vienna/video/7678002441849425164',
  {
    ...postData('Gratis Matcha bei New Year Cafe, 1070 Wien.', 'newyear.vienna'),
    timeDateTime: '2026-12-30T12:00:00.000Z',
  },
  { now: new Date('2027-01-02T12:00:00.000Z') },
);
assert.ok(crossYearFreshPost.deal, 'a genuinely fresh post remains valid across New Year');

const stalePreviousYearPost = buildDealFromPost(
  'https://www.tiktok.com/@old.vienna/video/7678002441849425165',
  {
    ...postData('Gratis Matcha bei Old Cafe, 1070 Wien.', 'old.vienna'),
    timeDateTime: '2026-01-02T12:00:00.000Z',
  },
  { now: new Date('2027-01-02T12:00:00.000Z') },
);
assert.equal(stalePreviousYearPost.deal, null);
assert.match(stalePreviousYearPost.reason, /älter als 7 Tage/);

const unicodeBoundaryCaption = `${'1+1 GRATIS '.padEnd(90, 'A')}Wien${'B'.repeat(89)}😀`;
const unicodeBoundaryDeal = build(
  'https://www.tiktok.com/@unicode.vienna/video/7674945375526030625',
  postData(unicodeBoundaryCaption, 'unicode.vienna'),
);
assert.ok(unicodeBoundaryDeal.deal);
assert.equal(
  containsLoneSurrogate(unicodeBoundaryDeal.deal.viennaEvidence.detail),
  false,
  'location evidence must never split an emoji into an invalid JSON surrogate',
);

const visualOnlyData = postData('Unser neuer Wochenplan', 'visual.cafe.wien');
visualOnlyData.bodyText = 'Unser neuer Wochenplan. Creator bio: coffee and brunch.';
visualOnlyData.mediaType = 'VIDEO';
visualOnlyData.mediaUrl = 'https://cdn.example/visual-cafe.mp4';
visualOnlyData.thumbnailUrl = 'https://cdn.example/visual-cafe.jpg';
const visualOnlyUrl = 'https://www.tiktok.com/@visual.cafe.wien/video/7678002441849425190';
const visualOnlyInitial = build(visualOnlyUrl, visualOnlyData);
assert.equal(visualOnlyInitial.deal, null);

const trustedVisualData = {
  ...visualOnlyData,
  _mediaEvidence: {
    analyzedAt: REFERENCE_NOW.toISOString(),
    ocrText: 'Zweiter Kaffee gratis, Neubaugasse 12, 1070 Wien',
    visionImageCount: 2,
    ai: {
      isDeal: true,
      confidence: 0.96,
      offerText: 'Zweiter Kaffee gratis',
      locationText: 'Neubaugasse 12, 1070 Wien',
      validityText: 'Gültig bis 30. August 2026',
      exclusion: 'none',
    },
  },
};
const trustedVisualDeal = build(visualOnlyUrl, trustedVisualData);
assert.ok(trustedVisualDeal.deal, 'trusted TikTok media evidence must recover an image-only deal');
assert.equal(trustedVisualDeal.deal.viennaEvidence.source, 'tiktok-media-ai');
assert.equal(trustedVisualDeal.deal.validUntil, '2026-08-30');
assert.equal(trustedVisualDeal.deal.ownerUsername, 'visual.cafe.wien');
assert.equal(trustedVisualDeal.deal.evidence.mediaEvidence.ai.confidence, 0.96);
assert.match(trustedVisualDeal.deal.description, /Bildbeleg/);

const personalCompensation = build(
  'https://www.tiktok.com/@assal.burger/video/7678002441849425194',
  {
    ...postData('Danke Anna #wien', 'assal.burger'),
    _mediaEvidence: {
      analyzedAt: REFERENCE_NOW.toISOString(),
      visionImageCount: 1,
      ai: {
        isDeal: true,
        confidence: 0.9,
        offerText: 'Gratis Pommes als Ersatz für ausverkauften hausgemachten Lotus',
        locationText: 'Wien',
        validityText: '',
        exclusion: 'none',
      },
    },
  },
);
assert.equal(personalCompensation.deal, null);
assert.match(personalCompensation.reason, /Kulanz/);

const staleVisualData = {
  ...visualOnlyData,
  timeDateTime: new Date(REFERENCE_NOW.getTime() - 120 * 60 * 60 * 1000).toISOString(),
};
const giveawayVisualData = {
  ...visualOnlyData,
  description: 'Gewinnspiel: Gewinne einen gratis Brunch.',
  title: 'Gewinnspiel: Gewinne einen gratis Brunch.',
  bodyText: 'Gewinnspiel: Gewinne einen gratis Brunch.',
};
const foreignVisualData = {
  ...visualOnlyData,
  description: 'Gratis Kaffee in Graz.',
  title: 'Gratis Kaffee in Graz.',
  bodyText: 'Gratis Kaffee in Graz.',
};
let rescueEntries = [];
const mediaRescue = await rescueTikTokMediaCandidates([
  { url: visualOnlyUrl, data: visualOnlyData, initial: visualOnlyInitial },
  { url: visualOnlyUrl, data: visualOnlyData, initial: visualOnlyInitial },
  {
    url: 'https://www.tiktok.com/@visual.cafe.wien/video/7678002441849425191',
    data: staleVisualData,
  },
  {
    url: 'https://www.tiktok.com/@visual.cafe.wien/video/7678002441849425192',
    data: giveawayVisualData,
  },
  {
    url: 'https://www.tiktok.com/@visual.cafe.wien/video/7678002441849425193',
    data: foreignVisualData,
  },
], {
  now: REFERENCE_NOW,
  env: {
    OPENAI_API_KEY: 'test-openai-key',
    TIKTOK_MEDIA_MAX_AGE_HOURS: '72',
  },
  cache: {},
  enrichMedia: async (entries) => {
    rescueEntries = entries;
    assert.equal(entries.length, 1, 'only one unique, fresh, non-excluded media candidate is analyzed');
    assert.equal(entries[0].item.media_type, 'VIDEO');
    assert.equal(entries[0].item.thumbnail_url, 'https://cdn.example/visual-cafe.jpg');
    entries[0].item._mediaEvidence = trustedVisualData._mediaEvidence;
    return {
      entries,
      cache: { [entries[0].item.id]: trustedVisualData._mediaEvidence },
      report: {
        status: 'ok',
        selected: 1,
        cached: 0,
        analyzed: 1,
        withOcrText: 1,
        withVisionImages: 1,
        aiCalls: 1,
        visionCalls: 1,
        aiAccepted: 1,
        errors: [],
      },
    };
  },
});
assert.equal(rescueEntries.length, 1);
assert.equal(mediaRescue.deals.length, 1);
assert.equal(mediaRescue.report.rescueCandidates, 4, 'duplicate URLs are removed before analysis');
assert.equal(mediaRescue.report.eligible, 1);
assert.equal(mediaRescue.report.rescuedDeals, 1);
assert.ok(mediaRescue.rescuedUrls.has(visualOnlyUrl));

const mediaOutage = await rescueTikTokMediaCandidates([
  { url: visualOnlyUrl, data: visualOnlyData, initial: visualOnlyInitial },
], {
  now: REFERENCE_NOW,
  env: { OPENAI_API_KEY: 'test-openai-key' },
  enrichMedia: async () => {
    throw new Error('OpenAI unavailable');
  },
});
assert.equal(mediaOutage.deals.length, 0);
assert.equal(mediaOutage.report.status, 'degraded');
assert.match(mediaOutage.report.errors.join(' '), /OpenAI unavailable/);

console.log('tiktok deal scanner tests passed');
