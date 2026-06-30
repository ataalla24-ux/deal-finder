import fs from 'fs';
import path from 'path';

export const LIVE_DEAL_EDIT_FIELDS = [
  'title',
  'brand',
  'description',
  'category',
  'type',
  'distance',
  'pubDate',
  'expires',
  'expiresOriginal',
  'expiryKind',
  'validOn',
  'validFrom',
  'validUntil',
  'expiryDisplayText',
  'pinnedRank',
];
export const LIVE_DEAL_RESTORE_FIELDS = [
  'id',
  'submissionId',
  'brand',
  'title',
  'description',
  'url',
  'category',
  'type',
  'logo',
  'distance',
  'source',
  'originSource',
  'expires',
  'expiresOriginal',
  'expiresPrecision',
  'expiresSource',
  'expiresDetectedFromUrl',
  'pubDate',
  'qualityScore',
  'votes',
  'priority',
  'hot',
  'isNew',
  'slackTs',
  'slackThreadTs',
  'approvedAt',
  'expiryKind',
  'validOn',
  'validFrom',
  'validUntil',
  'expiryDisplayText',
];

export function cleanText(value) {
  return String(value ?? '').trim();
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function dealArrayFromBundle(bundle) {
  if (Array.isArray(bundle)) return bundle;
  if (Array.isArray(bundle?.deals)) return bundle.deals;
  return null;
}

export function parseLiveDealEditPayload(rawPayload) {
  const raw = cleanText(rawPayload);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export function payloadValue(payload, key, envName) {
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  if (envName && Object.prototype.hasOwnProperty.call(process.env, envName)) return process.env[envName];
  return undefined;
}

export function parseBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = cleanText(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function normalizeRestoreDeal(raw, dealId = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = cleanText(raw.id || dealId);
  if (!id) return null;

  const restored = { id };
  for (const field of LIVE_DEAL_RESTORE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) continue;
    const value = raw[field];
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      restored[field] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) restored[field] = value;
    } else {
      const text = cleanText(value);
      if (text) restored[field] = text;
    }
  }

  restored.id = id;
  if (!cleanText(restored.title)) restored.title = cleanText(restored.brand) || id;
  if (!cleanText(restored.brand)) restored.brand = cleanText(restored.title) || 'FreeFinder';
  if (!cleanText(restored.distance)) restored.distance = 'Wien';
  if (!cleanText(restored.category)) restored.category = 'wien';
  if (!cleanText(restored.type)) restored.type = 'rabatt';
  if (!cleanText(restored.logo)) restored.logo = '🎯';
  if (!cleanText(restored.pubDate)) restored.pubDate = new Date().toISOString();
  if (!cleanText(restored.approvedAt)) restored.approvedAt = new Date().toISOString();
  return restored;
}

export function normalizePinnedRank(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseGermanDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseIsoDate(value) {
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function calendarDate(value) {
  const parsed = parseIsoDate(value) || parseGermanDate(value);
  if (!parsed) return cleanText(value);
  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
}

function displayDate(value) {
  const parsed = parseIsoDate(value) || parseGermanDate(value);
  if (!parsed) return cleanText(value);
  return `${pad2(parsed.day)}.${pad2(parsed.month)}.${parsed.year}`;
}

function isoDateTime(value, endOfDay = false) {
  const text = cleanText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const parsed = parseIsoDate(text) || parseGermanDate(text);
  if (!parsed) return text;
  const time = endOfDay ? '23:59:59.999Z' : '12:00:00.000Z';
  return `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}T${time}`;
}

function isEmptyDisplayDate(value) {
  const text = cleanText(value).toLowerCase();
  return !text || ['k.a.', 'ka', 'n/a', 'unbekannt'].includes(text);
}

function normalizeUrlForMatch(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function setIfPresent(target, source, field, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(source, field)) return false;
  const raw = source[field];
  const value = options.normalize ? options.normalize(raw) : cleanText(raw);
  if (options.skipEmpty !== false && value === '') return false;
  if (JSON.stringify(target[field] ?? '') === JSON.stringify(value)) return false;
  target[field] = value;
  return true;
}

function editMatchesDeal(edit, deal) {
  const editId = cleanText(edit.dealId);
  if (editId && editId === cleanText(deal?.id)) return true;
  if (editId) return false;
  const editUrl = normalizeUrlForMatch(edit.url || edit.dealUrl || '');
  const dealUrl = normalizeUrlForMatch(deal?.url || '');
  return Boolean(editUrl && dealUrl && editUrl === dealUrl);
}

export function normalizeLiveDealEdit(raw = {}, options = {}) {
  const dealId = cleanText(raw.dealId || raw.deal_id || raw.id);
  if (!dealId) return null;
  const nowIso = options.nowIso || new Date().toISOString();
  const existing = options.existing || {};
  const sourceUpdatedAt = Number(raw.updatedAtMs || 0);
  const updatedAt = cleanText(raw.updatedAt || raw.updated_at || raw.updatedAtIso)
    || (sourceUpdatedAt > 0 ? new Date(sourceUpdatedAt).toISOString() : nowIso);
  const edit = {
    dealId,
    url: cleanText(raw.url || raw.dealUrl || raw.deal_url || existing.url || ''),
    hidden: parseBoolean(raw.hidden),
    editedBy: cleanText(raw.editedBy || raw.edited_by || raw.updatedBy || existing.editedBy || 'live-review'),
    createdAt: cleanText(existing.createdAt || raw.createdAt || updatedAt),
    updatedAt,
  };
  const forceKeepValue = Object.prototype.hasOwnProperty.call(raw, 'forceKeep') && raw.forceKeep !== undefined
    ? raw.forceKeep
    : existing.forceKeep;
  if (parseBoolean(forceKeepValue)) edit.forceKeep = true;

  const restoreDeal = normalizeRestoreDeal(raw.restoreDeal || raw.restore_deal || existing.restoreDeal, dealId);
  if (restoreDeal) edit.restoreDeal = restoreDeal;

  for (const field of LIVE_DEAL_EDIT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field) && raw[field] !== undefined) {
      if (field === 'pinnedRank') {
        const pinnedRank = normalizePinnedRank(raw[field]);
        if (pinnedRank && pinnedRank > 0) edit[field] = pinnedRank;
      } else {
        edit[field] = cleanText(raw[field]);
      }
    } else if (Object.prototype.hasOwnProperty.call(existing, field)) {
      edit[field] = existing[field];
    }
  }

  if (edit.expires && !edit.expiresOriginal) edit.expiresOriginal = edit.expires;
  return edit;
}

export function loadLiveDealEditStore(filePath) {
  const parsed = readJson(filePath, null);
  if (!parsed || typeof parsed !== 'object') {
    return { version: 1, updatedAt: '', edits: [] };
  }
  const edits = Array.isArray(parsed.edits)
    ? parsed.edits.map((edit) => normalizeLiveDealEdit(edit)).filter(Boolean)
    : [];
  return {
    version: Number(parsed.version || 1),
    updatedAt: cleanText(parsed.updatedAt || ''),
    edits,
  };
}

export function saveLiveDealEditStore(filePath, store, nowIso = new Date().toISOString()) {
  const edits = Array.isArray(store?.edits) ? store.edits.map((edit) => normalizeLiveDealEdit(edit)).filter(Boolean) : [];
  edits.sort((left, right) => cleanText(left.dealId).localeCompare(cleanText(right.dealId)));
  writeJson(filePath, {
    version: 1,
    updatedAt: nowIso,
    edits,
  });
}

export function upsertLiveDealEdit(store, edit, nowIso = new Date().toISOString()) {
  const normalized = normalizeLiveDealEdit(edit, { nowIso });
  if (!normalized) throw new Error('Invalid live deal edit');
  const edits = Array.isArray(store?.edits) ? [...store.edits] : [];
  const index = edits.findIndex((item) => cleanText(item.dealId) === normalized.dealId);
  if (index >= 0) {
    edits[index] = normalizeLiveDealEdit(normalized, { existing: edits[index], nowIso });
  } else {
    edits.push(normalized);
  }
  return {
    version: 1,
    updatedAt: nowIso,
    edits,
  };
}

function applyEditToDeal(deal, edit, checkedAt) {
  if (edit.hidden) {
    return { deal: null, changedFields: ['hidden'], removed: true };
  }

  const next = { ...deal };
  const changed = [];
  if (setIfPresent(next, edit, 'title')) changed.push('title');
  if (setIfPresent(next, edit, 'brand')) changed.push('brand');
  if (setIfPresent(next, edit, 'description')) changed.push('description');
  if (setIfPresent(next, edit, 'category', { normalize: (value) => cleanText(value).toLowerCase() })) changed.push('category');
  if (setIfPresent(next, edit, 'type', { normalize: (value) => cleanText(value).toLowerCase() })) changed.push('type');
  if (setIfPresent(next, edit, 'distance')) changed.push('distance');
  if (setIfPresent(next, edit, 'pubDate', { normalize: (value) => isoDateTime(value, false) })) changed.push('pubDate');
  if (setIfPresent(next, edit, 'expires', { normalize: (value) => isoDateTime(value, true) })) changed.push('expires');
  if (setIfPresent(next, edit, 'expiresOriginal')) changed.push('expiresOriginal');
  if (setIfPresent(next, edit, 'expiryKind')) changed.push('expiryKind');
  if (setIfPresent(next, edit, 'validOn', { normalize: calendarDate })) changed.push('validOn');
  if (setIfPresent(next, edit, 'validFrom', { normalize: calendarDate })) changed.push('validFrom');
  if (setIfPresent(next, edit, 'validUntil', { normalize: calendarDate })) changed.push('validUntil');
  if (setIfPresent(next, edit, 'expiryDisplayText')) changed.push('expiryDisplayText');

  const pinnedRank = normalizePinnedRank(edit.pinnedRank);
  if (pinnedRank !== null && next.pinnedRank !== pinnedRank) {
    next.pinnedRank = pinnedRank;
    changed.push('pinnedRank');
  }

  if (cleanText(edit.expires)) {
    const parsedExpiry = parseIsoDate(edit.expires) || parseGermanDate(edit.expires);
    if (parsedExpiry) {
      const nextValidUntil = calendarDate(edit.expires);
      const nextDisplayDate = displayDate(edit.expires);
      if (next.validUntil !== nextValidUntil) {
        next.validUntil = nextValidUntil;
        changed.push('validUntil');
      }
      if (next.expiryKind !== 'end') {
        next.expiryKind = 'end';
        changed.push('expiryKind');
      }
      if (isEmptyDisplayDate(next.expiryDisplayText) || isEmptyDisplayDate(edit.expiryDisplayText)) {
        next.expiryDisplayText = nextDisplayDate;
        changed.push('expiryDisplayText');
      }
    }
  }

  const uniqueChanged = [...new Set(changed)];
  if (uniqueChanged.length === 0) return { deal, changedFields: [], removed: false };

  next.liveEditedAt = cleanText(edit.updatedAt) || checkedAt;
  next.liveEditedBy = cleanText(edit.editedBy) || 'live-review';
  next.liveEditedFields = uniqueChanged;
  return { deal: next, changedFields: uniqueChanged, removed: false };
}

function restoredDealFromEdit(edit, checkedAt) {
  const restoreDeal = normalizeRestoreDeal(edit.restoreDeal, edit.dealId);
  if (!restoreDeal || edit.hidden) return null;

  const base = {
    ...restoreDeal,
    id: cleanText(edit.dealId) || restoreDeal.id,
    url: cleanText(edit.url) || cleanText(restoreDeal.url),
    liveRestoredAt: checkedAt,
    liveRestoredBy: cleanText(edit.editedBy) || 'live-review',
    liveForceKeep: Boolean(edit.forceKeep),
  };

  const result = applyEditToDeal(base, edit, checkedAt);
  return result.deal || base;
}

export function applyLiveDealEditsToBundle(bundle, store, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const allowRemovals = options.allowRemovals === true;
  const deals = dealArrayFromBundle(bundle);
  if (!deals) throw new Error('Live deals bundle does not contain a deals array');

  const edits = Array.isArray(store?.edits) ? store.edits.map((edit) => normalizeLiveDealEdit(edit)).filter(Boolean) : [];
  const applied = [];
  const skippedRemovals = [];
  const missing = [];
  let changed = false;
  let nextDeals = [...deals];

  for (const edit of edits) {
    const index = nextDeals.findIndex((deal) => editMatchesDeal(edit, deal));
    if (index < 0) {
      const restoredDeal = restoredDealFromEdit(edit, checkedAt);
      if (restoredDeal) {
        nextDeals.push(restoredDeal);
        changed = true;
        applied.push({ dealId: edit.dealId, removed: false, changedFields: ['restore'] });
        continue;
      }
      missing.push({ dealId: edit.dealId, url: edit.url || '', hidden: Boolean(edit.hidden) });
      continue;
    }

    const result = applyEditToDeal(nextDeals[index], edit, checkedAt);
    if (result.removed) {
      nextDeals.splice(index, 1);
      changed = true;
      applied.push({ dealId: edit.dealId, removed: true, changedFields: result.changedFields });
      continue;
    }

    if (result.changedFields.length > 0) {
      nextDeals[index] = result.deal;
      changed = true;
      applied.push({ dealId: edit.dealId, removed: false, changedFields: result.changedFields });
    }
  }

  const report = {
    checkedAt,
    editCount: edits.length,
    beforeCount: deals.length,
    afterCount: nextDeals.length,
    appliedCount: applied.length,
    removalsEnabled: allowRemovals,
    removalsPaused: !allowRemovals,
    skippedRemovalCount: skippedRemovals.length,
    missingCount: missing.length,
    applied,
    skippedRemovals: skippedRemovals.slice(0, 200),
    missing: missing.slice(0, 200),
  };

  let nextBundle = bundle;
  if (changed) {
    if (Array.isArray(bundle)) {
      nextBundle = nextDeals;
    } else {
      nextBundle = {
        ...bundle,
        deals: nextDeals,
        totalDeals: nextDeals.length,
      };
      if ('lastUpdated' in nextBundle) nextBundle.lastUpdated = checkedAt;
      if ('updatedAt' in nextBundle) nextBundle.updatedAt = checkedAt;
    }
  }

  return { changed, bundle: nextBundle, report };
}
