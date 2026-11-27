import assert from 'node:assert/strict';

import {
  buildInstagramRoleIndex,
  inferInstagramAccountRole,
  instagramUsernameDisplayName,
  resolveInstagramPostEntities,
} from '../scraper/instagram-entity-resolution.js';

const accounts = [
  { username: 'lisa.maria.b', accountType: 'creator', viennaVerified: false },
  { username: 'tennosushiofficial', accountType: 'merchant', viennaVerified: true },
  { username: 'shaysfoodblog', accountType: 'creator' },
  { username: 'burgerking.at', accountType: 'merchant', viennaVerified: true },
];
const roleIndex = buildInstagramRoleIndex(accounts);

assert.equal(inferInstagramAccountRole({ username: 'shaysfoodblog' }), 'creator');
assert.equal(inferInstagramAccountRole({ username: 'blumencafe.wien', category: 'food' }), 'merchant');
assert.equal(inferInstagramAccountRole({ username: 'vorteilsclub.wien' }), 'platform');
assert.equal(instagramUsernameDisplayName('tennosushiofficial'), 'Tenno Sushi');
assert.equal(instagramUsernameDisplayName('blumen_cafe.wien'), 'Blumen Cafe');

const creatorPost = resolveInstagramPostEntities({
  ownerUsername: 'lisa.maria.b',
  caption: 'Anzeige: Bis zu 50 % auf Sushi bei @tennosushiofficial in 1030 Wien.',
  roleIndex,
});
assert.equal(creatorPost.ownerRole, 'creator');
assert.equal(creatorPost.scoutUsername, 'lisa.maria.b');
assert.equal(creatorPost.merchantUsername, 'tennosushiofficial');
assert.equal(creatorPost.resolutionMethod, 'caption-mention');

const merchantPost = resolveInstagramPostEntities({
  ownerUsername: 'tennosushiofficial',
  caption: 'Heute 20 % Rabatt auf Sushi.',
  roleIndex,
});
assert.equal(merchantPost.scoutUsername, '');
assert.equal(merchantPost.merchantUsername, 'tennosushiofficial');
assert.equal(merchantPost.resolutionMethod, 'owner-is-merchant');

const unresolvedCreator = resolveInstagramPostEntities({
  ownerUsername: 'shaysfoodblog',
  caption: 'Neuer Food Deal in Wien, Details im Video.',
  roleIndex,
});
assert.equal(unresolvedCreator.merchantUsername, '');
assert.equal(unresolvedCreator.resolutionMethod, 'unresolved-scout-post');

const graphCaptionWithoutAt = resolveInstagramPostEntities({
  ownerUsername: 'shaysfoodblog',
  caption: 'Neuer Chicken Spot in Wien zum fairen Preis bei eat.hendl im 15 Bezirk.',
  roleIndex,
});
assert.equal(graphCaptionWithoutAt.merchantUsername, 'eat.hendl');

const standaloneGraphHandle = resolveInstagramPostEntities({
  ownerUsername: 'foodiewien',
  caption: 'Ramen aus Japan in Wien - ramen.makotoya #ramen #vienna *anzeige',
  roleIndex,
});
assert.equal(standaloneGraphHandle.merchantUsername, 'ramen.makotoya');

const plainViennaHandle = resolveInstagramPostEntities({
  ownerUsername: 'lisa.maria.b',
  caption: '10 % Rabatt auf eure Buchung bei magicworldvienna in 1020 Wien.',
  roleIndex,
});
assert.equal(plainViennaHandle.merchantUsername, 'magicworldvienna');

const suspiciousShortHandle = resolveInstagramPostEntities({
  ownerUsername: 'vorteilsclub.wien',
  caption: 'Schulstart mit Sparvorteil. Mit dem Vorteilsclub sparst du 20 %. Technischer Text bei @0w.',
  roleIndex,
});
assert.equal(suspiciousShortHandle.merchantUsername, '');

const sentenceEnding = resolveInstagramPostEntities({
  caption: 'Beauty-Aktion in Wien. Nicht mit anderen Aktionen kombinierbar. #wien',
});
assert.equal(sentenceEnding.merchantUsername, '');
assert.deepEqual(sentenceEnding.bareMerchantUsernames, []);
const pollutedRoleIndex = buildInstagramRoleIndex([{ username: 'kombinierbar.', accountType: 'merchant', viennaVerified: true }]);
assert.equal(resolveInstagramPostEntities({
  caption: 'Beauty-Aktion in Wien. Nicht mit anderen Aktionen kombinierbar. #wien',
  roleIndex: pollutedRoleIndex,
}).merchantUsername, '', 'past false positives in the learned account index cannot revive the sentence word');
assert.equal(resolveInstagramPostEntities({
  caption: 'Rabatt für Mitglieder. Auf andere Personen nicht übertragbar. #aktion',
}).merchantUsername, '');
assert.equal(resolveInstagramPostEntities({
  ownerUsername: 'shaysfoodblog',
  caption: 'Heute 20 % bei salon.beauty.at. #aktion',
  roleIndex,
}).merchantUsername, 'salon.beauty.at');
assert.equal(resolveInstagramPostEntities({
  ownerUsername: 'shaysfoodblog',
  caption: 'Neuer Spot in Wien - ramen.makotoya. #ramen',
  roleIndex,
}).merchantUsername, 'ramen.makotoya');

console.log('instagram entity resolution tests passed');
