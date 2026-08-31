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

console.log('instagram entity resolution tests passed');
