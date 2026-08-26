#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { syncFeaturedDealSnapshots } from '../scraper/native-weekly-utils.js';

const root = process.cwd();
const dealsPath = path.join(root, 'docs', 'deals.json');
const dailyPath = path.join(root, 'docs', 'deal-of-the-day.json');
const weeklyPath = path.join(root, 'docs', 'deal-of-the-week.json');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const dealsBundle = readJson(dealsPath, { deals: [] });
const dailyPick = readJson(dailyPath, {});
const weeklyPick = readJson(weeklyPath, {});
const result = syncFeaturedDealSnapshots(dealsBundle, dailyPick, weeklyPick);

if (result.daily.changed) writeJson(dailyPath, result.daily.payload);
if (result.weekly.changed) writeJson(weeklyPath, result.weekly.payload);

console.log(
  `Featured references: daily=${result.daily.report.reason} (${result.daily.report.targetId || 'none'}), `
  + `weekly=${result.weekly.report.reason} (${result.weekly.report.targetId || 'none'})`,
);
