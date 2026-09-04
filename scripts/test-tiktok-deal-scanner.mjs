import assert from 'node:assert/strict';

import {
  buildTikTokApiKeywords,
  buildTikTokMediaConfig,
  buildDealFromPost,
  dedupeTikTokDeals,
  rescueTikTokMediaCandidates,
} from '../scraper/tiktok-deals-scanner.js';

const REFERENCE_NOW = new Date('2026-08-26T12:00:00.000Z');

assert.equal(buildTikTokMediaConfig({}).mediaTesseractTimeoutMs, 8000);
assert.equal(buildTikTokMediaConfig({}).mediaMaxVideoFrames, 2);
assert.equal(buildTikTokMediaConfig({
  TIKTOK_MEDIA_TESSERACT_TIMEOUT_MS: '12000',
}).mediaTesseractTimeoutMs, 12000);
assert.equal(buildTikTokMediaConfig({
  TIKTOK_MEDIA_TESSERACT_TIMEOUT_MS: '99999',
}).mediaTesseractTimeoutMs, 30000);

const currentSearchKeywords = buildTikTokApiKeywords(REFERENCE_NOW);
assert.equal(currentSearchKeywords[0], 'wien gratis 26 august 2026');
assert.ok(currentSearchKeywords.includes('wien neueröffnung august 2026'));
assert.ok(currentSearchKeywords.includes('wien gratis september 2026'));
assert.ok(currentSearchKeywords.includes('vienna deals september 2026'));
assert.ok(
  currentSearchKeywords.indexOf('wien gratis august 2026') < currentSearchKeywords.indexOf('wien gratis heute'),
  'current month/year searches must run before generic queries can consume the candidate budget',
);
const decemberSearchKeywords = buildTikTokApiKeywords(new Date('2026-12-20T12:00:00.000Z'));
assert.ok(decemberSearchKeywords.includes('wien gratis januar 2027'), 'future-offer search rolls over the year');

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
assert.equal(creatorPostWithNamedProvider.deal.sourceAccountType, 'creator');
assert.equal(creatorPostWithNamedProvider.deal.scoutUsername, 'kseniainvienna');
assert.equal(creatorPostWithNamedProvider.deal.merchantUsername, 'dyson');
assert.equal(creatorPostWithNamedProvider.deal.merchantName, 'Dyson');
assert.equal(creatorPostWithNamedProvider.deal.pipelineLifecycle.stage, 'extracted');

const secondDysonCreatorPost = build(
  'https://www.tiktok.com/@johannasteachervibes/video/7678693667174878486',
  postData(
    'Hab mir heute bei der Vienna Dyson Styling Tour meine Haare einfach gratis stylen lassen. @Dyson DACH, 26 – 29 August 2026, Rathausplatz, 1010 Wien.',
    'johannasteachervibes',
  ),
);
assert.ok(secondDysonCreatorPost.deal);
assert.equal(secondDysonCreatorPost.deal.brand, 'Dyson');
assert.equal(secondDysonCreatorPost.deal.title, 'Gratis Haarstyling beim Dyson Pop-up');
const dedupedDysonDeals = dedupeTikTokDeals([
  { ...creatorPostWithNamedProvider.deal, qualityScore: 72 },
  { ...secondDysonCreatorPost.deal, qualityScore: 74 },
]);
assert.equal(dedupedDysonDeals.length, 1, 'creator crossposts of the same event collapse before Slack');
assert.equal(
  dedupedDysonDeals[0].url,
  creatorPostWithNamedProvider.deal.url,
  'the richer event evidence wins even when the newer crosspost has a higher recency score',
);

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

const viennaVirginia = build(
  'https://www.tiktok.com/@snickolas/video/7679922843357826318',
  postData(
    "Let's try Bakeshop in Vienna, VA! Vietnamese iced coffee pie and a gluten-free brownie.",
    'snickolas',
  ),
);
assert.equal(viennaVirginia.deal, null);
assert.match(viennaVirginia.reason, /Wien-Signal/);

const northernVirginiaVenues = build(
  'https://www.tiktok.com/@dermestetics/video/7680266392960126239',
  postData(
    'Daxxify for $12 a unit, one day only. Reston, Gainesville, Warrenton, Vienna, Arlington and McLean. #dmv',
    'dermestetics',
  ),
);
assert.equal(northernVirginiaVenues.deal, null);
assert.match(northernVirginiaVenues.reason, /Wien-Signal/);

const glutenFreeAttribute = build(
  'https://www.tiktok.com/@bakery.wien/video/7678002441849425197',
  postData('Neue Bakery in 1070 Wien. Der Brownie ist gluten free.', 'bakery.wien'),
);
assert.equal(glutenFreeAttribute.deal, null);
assert.match(glutenFreeAttribute.reason, /kein starkes Gratis-\/Deal-Signal/);

const realDealWithGlutenFreeAttribute = build(
  'https://www.tiktok.com/@bakery.wien/video/7678002441849425198',
  postData('1+1 gratis auf gluten-free Brownies bei Brownie Bar, 1070 Wien.', 'bakery.wien'),
);
assert.ok(realDealWithGlutenFreeAttribute.deal);
assert.equal(realDealWithGlutenFreeAttribute.deal.type, 'bogo');

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

const freeBookingOnly = build(
  'https://www.tiktok.com/@hcikitchen/video/7678002441849425156',
  postData(
    'Healthy cooking tips and the Saladmaster experience in 1020 Vienna. Contact us and book with us for FREE!',
    'hcikitchen',
  ),
);
assert.equal(freeBookingOnly.deal, null);
assert.match(freeBookingOnly.reason, /kostenlose Buchung\/Kontaktaufnahme/);

const editorialRoundup = build(
  'https://www.tiktok.com/@wientipps/video/7678002441849425157',
  postData(
    'September in Wien: 8 Ideen - Teil 2. Viele weitere Events findest du auf meinem Blog. Musicalfest gratis. Tag des Sports gratis.',
    'wientipps',
  ),
);
assert.equal(editorialRoundup.deal, null);
assert.match(editorialRoundup.reason, /Mehrfach-Roundup/);

const inboundViennaPackage = build(
  'https://www.tiktok.com/@foreigntravel/video/7678002441849425158',
  postData(
    'Vienna trip from 13 to 15 October for €199. Vienna ti aspetta per un viaggio da sogno. #Viaggiare',
    'foreigntravel',
  ),
);
assert.equal(inboundViennaPackage.deal, null);
assert.match(inboundViennaPackage.reason, /Reisepaket nach Wien/);

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

const limitedTicketAllocation = build(
  'https://www.tiktok.com/@jaycatchme/video/7678374897038527766',
  postData('Holt euch 2x Free Tickets 🎟️ #live #wien #konzert', 'jaycatchme'),
);
assert.equal(limitedTicketAllocation.deal, null);
assert.match(limitedTicketAllocation.reason, /Begrenzte Gratis-Vergabe/);

const guaranteedTicketCode = build(
  'https://www.tiktok.com/@concert.wien/video/7678374897038527767',
  postData('Mit Code VIENNA bekommt jede Person 2x Free Tickets für das Konzert in 1010 Wien.', 'concert.wien'),
);
assert.ok(guaranteedTicketCode.deal, 'a per-person redemption code remains a directly usable deal');

const genericTravelGuide = build(
  'https://www.tiktok.com/@laura.the.explore70/video/7678002441849425156',
  postData(
    'Saving the best of Vienna for your travel bucket list! From free hidden gems to iconic architecture. Save this post for your itinerary!',
    'laura.the.explore70',
  ),
);
assert.equal(genericTravelGuide.deal, null);
assert.match(genericTravelGuide.reason, /Reiseguide/);

const genericPayWhatYouWishWeekend = build(
  'https://www.tiktok.com/@elena.mov/video/7678002441849425184',
  postData(
    'Dein gratis/pay as you wish Wochende von mir für dich! #vienna #wientipps #events #flohmarkt #rave',
    'elena.mov',
  ),
);
assert.equal(genericPayWhatYouWishWeekend.deal, null);
assert.match(genericPayWhatYouWishWeekend.reason, /Event-Sammlung/);

const foreignCreatorWithoutViennaVenue = build(
  'https://www.tiktok.com/@muerdelatartavalencia/video/7678002441849425185',
  postData('Ositos de peluche gratis con el café. #vienna #bear #coffeeshop', 'muerdelatartavalencia'),
);
assert.equal(foreignCreatorWithoutViennaVenue.deal, null);
assert.match(foreignCreatorWithoutViennaVenue.reason, /Ortsbeleg/);

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

const soundcubeKidsClass = build(
  'https://www.tiktok.com/@temibrowncoffee/video/7678068346285346070',
  postData(
    'My FREE Kids’ Afro Dance Class is happening this Sunday, 30th August 2026. Age (7-12). Soundcube, Guglgasse 12, Gasometer C, Vienna, Austria. FREE CLASS. Dm to register.',
    'temibrowncoffee',
  ),
);
assert.ok(soundcubeKidsClass.deal);
assert.equal(soundcubeKidsClass.deal.brand, 'Soundcube');
assert.equal(soundcubeKidsClass.deal.title, 'Kostenloser Afro-Dance-Kurs für Kinder im Soundcube');
assert.equal(soundcubeKidsClass.deal.category, 'freizeit');
assert.equal(soundcubeKidsClass.deal.logo, '💃');
assert.equal(soundcubeKidsClass.deal.validFrom, '2026-08-30');
assert.equal(soundcubeKidsClass.deal.validUntil, '2026-08-30');

const directMessageWithoutDmStore = build(
  'https://www.tiktok.com/@communitydance/video/7678068346285346071',
  postData('Free dance class at Guglgasse 12, 1110 Vienna. DM us to register.', 'communitydance'),
);
assert.ok(directMessageWithoutDmStore.deal);
assert.notEqual(directMessageWithoutDmStore.deal.brand, 'dm', 'direct-message instructions are not dm store evidence');

const rhetoricalAlmostFree = postData(
  '1150 Wien, Mariahilfer Str. 206 #aktion #angebot #sale',
  'voolehome',
);
rhetoricalAlmostFree._mediaEvidence = {
  analyzedAt: REFERENCE_NOW.toISOString(),
  visionImageCount: 1,
  ai: {
    isDeal: true,
    confidence: 0.95,
    offerText: 'Fast gratis! Nur um 499€.',
    locationText: 'Mariahilfer Straße 206, 1150 Wien',
    validityText: 'Bis 29. August 2026',
    exclusion: 'none',
  },
};
const rhetoricalAlmostFreeResult = build(
  'https://www.tiktok.com/@voolehome/video/7678760854053063958',
  rhetoricalAlmostFree,
);
assert.equal(rhetoricalAlmostFreeResult.deal, null);
assert.match(rhetoricalAlmostFreeResult.reason, /rhetorische Gratis-Aussage/);

const sipsyLaunchParty = build(
  'https://www.tiktok.com/@sipsybar.vie/video/7677874481657859350',
  postData(
    'Es ist endlich soweit! SIPSY LAUNCH PARTY mit kostenlosen Mocktails, Bowls & Good Vibes. 30. August 2026, Gastgebgasse 4, 1230 Wien.',
    'sipsybar.vie',
    24,
  ),
);
assert.ok(sipsyLaunchParty.deal);
assert.equal(sipsyLaunchParty.deal.brand, 'SIPSY');
assert.equal(sipsyLaunchParty.deal.title, 'Gratis Mocktails bei der SIPSY Launch Party');
assert.equal(sipsyLaunchParty.deal.category, 'kaffee');
assert.equal(sipsyLaunchParty.deal.validFrom, '2026-08-30');
assert.equal(sipsyLaunchParty.deal.validUntil, '2026-08-30');

const regularAgeTier = build(
  'https://www.tiktok.com/@sananabeel_3/video/7677205258715532566',
  postData(
    'Pakistani breakfast event in Vienna. Children under 5 years are free, 5-12 years 10€, 12 years onwards 20€.',
    'sananabeel_3',
  ),
);
assert.equal(regularAgeTier.deal, null);
assert.match(regularAgeTier.reason, /Altersstaffel/);

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

const weekdayBeforeNumericEnd = build(
  'https://www.tiktok.com/@chocoberry.at/video/7678679890975051030',
  postData(
    '1+1 GRATIS BEI CHOCOBERRY! Verlängert bis Freitag 28.08. Kauf 1 Becher und erhalte den 2. gratis. Copa Beach Wien.',
    'chocoberry.at',
  ),
);
assert.ok(weekdayBeforeNumericEnd.deal);
assert.equal(weekdayBeforeNumericEnd.deal.validUntil, '2026-08-28');
assert.equal(weekdayBeforeNumericEnd.deal.expires, '2026-08-28');

const expiredWeekdayBeforeNumericEnd = buildDealFromPost(
  'https://www.tiktok.com/@chocoberry.at/video/7678679890975051030',
  postData(
    '1+1 GRATIS BEI CHOCOBERRY! Verlängert bis Freitag 28.08. Kauf 1 Becher und erhalte den 2. gratis. Copa Beach Wien.',
    'chocoberry.at',
  ),
  { now: new Date('2026-09-01T12:00:00.000Z') },
);
assert.equal(expiredWeekdayBeforeNumericEnd.deal, null);
assert.match(expiredWeekdayBeforeNumericEnd.reason, /abgelaufen/);

const shippingOnly = build(
  'https://www.tiktok.com/@herr.wien/video/7679495087184776470',
  postData('Nur 250 € und GRATIS Lieferung. Geblergasse 60, 1170 Wien.', 'herr.wien'),
);
assert.equal(shippingOnly.deal, null);
assert.match(shippingOnly.reason, /Gratis-Lieferung\/Versand/);

const discountWithShipping = build(
  'https://www.tiktok.com/@shop.wien/video/7679495087184776471',
  postData('30% Rabatt auf alle Burger plus gratis Lieferung bis 30.08. in 1070 Wien.', 'shop.wien'),
);
assert.ok(discountWithShipping.deal, 'an independent discount remains valid when shipping is also free');
assert.equal(discountWithShipping.deal.type, 'rabatt');

const tourismGuide = build(
  'https://www.tiktok.com/@austriannaa/video/7679765096905608470',
  postData(
    "Exploring Vienna's Best Kept Secrets: Free Hidden Gems You Need to Visit. Wander the park and see the golden dome completely free.",
    'austriannaa',
  ),
);
assert.equal(tourismGuide.deal, null);
assert.match(tourismGuide.reason, /Sehenswürdigkeits|Freizeitempfehlung/);

const datedBulletRoundup = build(
  'https://www.tiktok.com/@austriannaa/video/7679384436122586390',
  postData(
    'Free Vienna events: • Film Festival at Rathausplatz (Until September 6, 2026), free screenings. • Long Night of Vienna Markets (September 4, 2026), free entry.',
    'austriannaa',
  ),
);
assert.equal(datedBulletRoundup.deal, null);
assert.match(datedBulletRoundup.reason, /Mehrfach-Roundup/);

const burgerWithSecondaryDrink = build(
  'https://www.tiktok.com/@eatinvienna/video/7679837905421929750',
  postData(
    'Gratis Burger für Schüler und Studenten am 07.09 10-13 Uhr. Danach Mittagsmenü mit Burger, Pommes und Getränk für 9,90 €. Jägerstraße 40, 1200 Wien.',
    'eatinvienna',
  ),
);
assert.ok(burgerWithSecondaryDrink.deal);
assert.equal(burgerWithSecondaryDrink.deal.category, 'essen');
assert.equal(burgerWithSecondaryDrink.deal.validFrom, '2026-09-07');
assert.equal(burgerWithSecondaryDrink.deal.validUntil, '2026-09-07');

const woaSchoolDeal = build(
  'https://www.tiktok.com/@woa.vienna/video/7680472988856143126',
  postData(
    'School’s back. Sushi’s on us. Deshalb gibt’s für alle Schüler:innen am Montag, den 7. September ein Gratis All-you-can-eat bei WOA. Am Graben 29a, 1010 Wien. #woa #woaamgraben #vienna #allyoucaneat #asianfood',
    'woa.vienna',
  ),
);
assert.ok(woaSchoolDeal.deal);
assert.equal(woaSchoolDeal.deal.title, 'Gratis All-you-can-eat für Schüler:innen bei WOA');
assert.equal(woaSchoolDeal.deal.merchantName, 'WOA');
assert.equal(woaSchoolDeal.deal.category, 'essen');
assert.equal(woaSchoolDeal.deal.validUntil, '2026-09-07');

const datedCinemaProgram = build(
  'https://www.tiktok.com/@frishwienxtra/video/7679219452889599234',
  postData(
    'Gratis Open-Air-Kino im Weghuberpark, 1070 Wien. Programm: 1.9. – Star Trek, 2.9. – Bibi & Tina, 3.9. – MAMMA MIA! Der Eintritt ist gratis.',
    'frishwienxtra',
  ),
);
assert.ok(datedCinemaProgram.deal);
assert.equal(datedCinemaProgram.deal.validFrom, '2026-09-01');
assert.equal(datedCinemaProgram.deal.validUntil, '2026-09-03');

const birthdayEntrySpecial = build(
  'https://www.tiktok.com/@asiannight/video/7678762157336546582',
  postData(
    'Bereit für eine Nacht voller Beats & Vibes? Freitag, 11/09, Babenberger Passage, 1010 Wien. Kostenlose Fotobox und gratis Süßigkeiten. Birthday Special: Du hast Geburtstag? Komm mit einer Begleitperson und ihr zahlt jeweils nur €10 Eintritt!',
    'asiannight',
  ),
);
assert.ok(birthdayEntrySpecial.deal);
assert.equal(birthdayEntrySpecial.deal.brand, 'ASIANNIGHT');
assert.equal(birthdayEntrySpecial.deal.title, 'Birthday-Special: Eintritt um 10 € bei ASIANNIGHT');
assert.equal(birthdayEntrySpecial.deal.type, 'rabatt');
assert.equal(birthdayEntrySpecial.deal.validUntil, '2026-09-11');
assert.ok(birthdayEntrySpecial.deal.qualityScore >= 58, 'a concrete promotional entry price clears the quality threshold');

const birthdayEntryWithoutFreebie = build(
  'https://www.tiktok.com/@birthdayclub/video/7678762157336546583',
  postData('Birthday Special in 1010 Wien: Du zahlst nur €10 Eintritt.', 'birthdayclub', 72),
);
assert.ok(birthdayEntryWithoutFreebie.deal, 'a birthday entry special does not depend on an incidental free add-on');
assert.equal(birthdayEntryWithoutFreebie.deal.type, 'rabatt');
assert.ok(birthdayEntryWithoutFreebie.deal.qualityScore >= 58);

const incidentalBirthdayMention = build(
  'https://www.tiktok.com/@viennastory/video/7678762157336546584',
  postData('Ich habe hier meinen Geburtstag gefeiert. Der reguläre Eintritt kostet €10. Adresse: 1010 Wien.', 'viennastory'),
);
assert.equal(incidentalBirthdayMention.deal, null);
assert.match(incidentalBirthdayMention.reason, /Deal-Signal/);

const sunsetCinema = build(
  'https://www.tiktok.com/@frishwienxtra/video/7676417793163644182',
  postData(
    'Im September geht unser gratis Cinemagic Open-Air-Kino das SUNSET CINEMA in die letzte Runde. Es warten noch 3 Termine auf euch und das natürlich kostenlos. Alle Termine finden im Weghuberpark statt. #wien',
    'frishwienxtra',
    72,
  ),
);
assert.ok(sunsetCinema.deal);
assert.equal(sunsetCinema.deal.brand, 'WIENXTRA');
assert.equal(sunsetCinema.deal.title, 'Gratis Open-Air-Kino Sunset Cinema im Weghuberpark');
assert.equal(sunsetCinema.deal.type, 'gratis');
assert.equal(sunsetCinema.deal.validFrom, '2026-09-01');
assert.equal(sunsetCinema.deal.validUntil, '2026-09-30');

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
    url: 'https://www.tiktok.com/@visual.cafe.wien/video/7678002441849425199',
    data: visualOnlyData,
    initial: visualOnlyInitial,
  },
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
    assert.ok(entries[0].context.mediaPriorityBoost > 0);
    assert.equal(entries[0].context.account.username, 'visual.cafe.wien');
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
assert.equal(mediaRescue.report.rescueCandidates, 5, 'duplicate URLs are removed before analysis');
assert.equal(mediaRescue.report.eligible, 2);
assert.equal(mediaRescue.report.deduplicatedEligible, 1);
assert.equal(mediaRescue.report.duplicateCandidatesSkipped, 1);
assert.equal(mediaRescue.report.rescuedDeals, 1);
assert.ok(mediaRescue.rescuedUrls.has(visualOnlyUrl));

let realPipelineClassifications = 0;
const realPipelineRescue = await rescueTikTokMediaCandidates([
  { url: visualOnlyUrl, data: visualOnlyData, initial: visualOnlyInitial },
], {
  now: REFERENCE_NOW,
  env: { OPENAI_API_KEY: 'test-openai-key' },
  cache: {},
  mediaTools: { tesseract: true, ffmpeg: true, ffprobe: true },
  analyzeMediaItem: async () => ({
    ocrText: 'Zweiter Kaffee gratis, Neubaugasse 12, 1070 Wien',
    visionImages: ['data:image/jpeg;base64,AQID'],
    assetCount: 1,
    availableAssetCount: 1,
    imageCount: 1,
    videoFrameCount: 1,
    errors: [],
    warnings: [],
  }),
  classifyMedia: async () => {
    realPipelineClassifications += 1;
    return trustedVisualData._mediaEvidence.ai;
  },
});
assert.equal(realPipelineClassifications, 1);
assert.equal(realPipelineRescue.deals.length, 1, 'a plausible Vienna food post remains eligible for media rescue');

const globalPromoData = postData('20 % Rabatt auf Skechers, nur heute.', 'savingston');
globalPromoData.bodyText = globalPromoData.description;
globalPromoData.mediaType = 'VIDEO';
globalPromoData.mediaUrl = 'https://cdn.example/global-promo.mp4';
globalPromoData.thumbnailUrl = 'https://cdn.example/global-promo.jpg';
const globalPromoUrl = 'https://www.tiktok.com/@savingston/video/7678002441849425195';
const globalPromoInitial = build(globalPromoUrl, globalPromoData);
assert.equal(globalPromoInitial.reason, 'kein eindeutiges Wien-Signal');
let globalPromoClassifications = 0;
const gatedGlobalPromo = await rescueTikTokMediaCandidates([
  { url: globalPromoUrl, data: globalPromoData, initial: globalPromoInitial },
], {
  now: REFERENCE_NOW,
  env: { OPENAI_API_KEY: 'test-openai-key' },
  cache: {},
  mediaTools: { tesseract: true, ffmpeg: true, ffprobe: true },
  analyzeMediaItem: async () => ({
    ocrText: '20 % Rabatt auf Skechers',
    visionImages: ['data:image/jpeg;base64,AQID'],
    assetCount: 1,
    availableAssetCount: 1,
    imageCount: 1,
    videoFrameCount: 1,
    errors: [],
    warnings: [],
  }),
  classifyMedia: async () => {
    globalPromoClassifications += 1;
    return { isDeal: true, confidence: 0.95, offerText: '20 % Rabatt', exclusion: 'none' };
  },
});
assert.equal(globalPromoClassifications, 0, 'global promos without Vienna, local-account or food evidence skip the LLM');
assert.equal(gatedGlobalPromo.report.aiSkippedUnrecoverable, 1);
assert.equal(gatedGlobalPromo.deals.length, 0);

const unusableAiData = {
  ...globalPromoData,
  title: '20 % Rabatt auf Burger.',
  description: '20 % Rabatt auf Burger.',
  bodyText: '20 % Rabatt auf Burger.',
};
const unusableAiUrl = 'https://www.tiktok.com/@savingston/video/7678002441849425196';
const unusableAiInitial = build(unusableAiUrl, unusableAiData);
const unusableAiResult = await rescueTikTokMediaCandidates([
  { url: unusableAiUrl, data: unusableAiData, initial: unusableAiInitial },
], {
  now: REFERENCE_NOW,
  env: { OPENAI_API_KEY: 'test-openai-key' },
  enrichMedia: async (entries) => {
    entries[0].item._mediaEvidence = {
      analyzedAt: REFERENCE_NOW.toISOString(),
      ocrText: '20 % Rabatt auf Burger',
      ai: {
        isDeal: true,
        confidence: 0.95,
        offerText: '20 % Rabatt auf Burger',
        locationText: '',
        validityText: '',
        exclusion: 'none',
      },
    };
    return { entries, cache: {}, report: { status: 'ok', aiAccepted: 1, errors: [] } };
  },
});
assert.equal(unusableAiResult.deals.length, 0);
assert.equal(unusableAiResult.report.aiAcceptedUnusable, 1, 'AI positives that still fail Vienna/deal gates are counted directly');

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
