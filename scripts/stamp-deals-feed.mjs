#!/usr/bin/env node
import path from 'node:path';

import { stampDealsFeedFile } from './deals-feed-contract.mjs';

const filePath = path.resolve(process.argv[2] || 'docs/deals.json');
const stamped = stampDealsFeedFile(filePath);
console.log(`Stamped deals feed ${stamped.feedVersion} (${stamped.totalDeals} deals)`);
