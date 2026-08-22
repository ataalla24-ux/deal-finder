import assert from 'node:assert/strict';

import { buildDealFromPost } from '../scraper/tiktok-deals-scanner.js';

function postData(description, accountHandle = 'vienna.deals', ageHours = 1) {
  return {
    accountHandle,
    title: description,
    description,
    bodyText: `${description} Creator bio: Vienna tips and free events.`,
    timeDateTime: new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString(),
    jsonLdUploadDate: '',
    jsonLdDatePublished: '',
    createTimes: [],
  };
}

const validMatcha = buildDealFromPost(
  'https://www.tiktok.com/@laserglow_vienna/video/7676841760328371478',
  postData('Gratis Matcha bei Laser Glow, Kaiserstraße 105, 1070 Wien.', 'laserglow_vienna'),
);
assert.ok(validMatcha.deal);
assert.match(validMatcha.deal.title, /Gratis Matcha/);

const foreignViennaHandle = buildDealFromPost(
  'https://www.tiktok.com/@twofatpanda.vienna/video/7676699636131761415',
  postData('Free treats every weekend at Two Fat Panda Vienna, Gading Serpong, Indonesia.', 'twofatpanda.vienna'),
);
assert.equal(foreignViennaHandle.deal, null);
assert.match(foreignViennaHandle.reason, /Wien-Signal/);

const losAngelesKeywordLeak = buildDealFromPost(
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
const validProfileContext = buildDealFromPost(
  'https://www.tiktok.com/@datriboxing/video/7676026132944276758',
  verifiedProfileContext,
);
assert.ok(validProfileContext.deal);
assert.equal(validProfileContext.deal.viennaEvidence.source, 'tiktok-post');
assert.match(validProfileContext.deal.viennaEvidence.detail, /Vienna/i);

const bioMustNotCreateOffer = buildDealFromPost(
  'https://www.tiktok.com/@lara_kristiin/video/7676529485998656790',
  postData('Dieses Wochenende findet der Neustifter Kirtag in Wien mit Essen und Musik statt.', 'lara_kristiin'),
);
assert.equal(bioMustNotCreateOffer.deal, null);
assert.match(bioMustNotCreateOffer.reason, /Deal-Signal/);

const genericFreeListing = buildDealFromPost(
  'https://www.tiktok.com/@creator/video/7674945375526030624',
  postData('I love the amount of free events happening all the time in Vienna: concerts, festivals and activities.', 'creator'),
);
assert.equal(genericFreeListing.deal, null);
assert.match(genericFreeListing.reason, /Deal-Signal/);

console.log('tiktok deal scanner tests passed');
