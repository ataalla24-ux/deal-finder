import assert from 'node:assert/strict';

import { buildDealFromPost } from '../scraper/tiktok-deals-scanner.js';

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

const creatorPostWithNamedProvider = buildDealFromPost(
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

const unicodeBoundaryCaption = `${'1+1 GRATIS '.padEnd(90, 'A')}Wien${'B'.repeat(89)}😀`;
const unicodeBoundaryDeal = buildDealFromPost(
  'https://www.tiktok.com/@unicode.vienna/video/7674945375526030625',
  postData(unicodeBoundaryCaption, 'unicode.vienna'),
);
assert.ok(unicodeBoundaryDeal.deal);
assert.equal(
  containsLoneSurrogate(unicodeBoundaryDeal.deal.viennaEvidence.detail),
  false,
  'location evidence must never split an emoji into an invalid JSON surrogate',
);

console.log('tiktok deal scanner tests passed');
