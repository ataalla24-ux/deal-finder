import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loginConfigurationAudit } from './lib/instagram-login-policy.mjs';

export function cookieFields(raw) {
  const text = String(raw || '').trim();
  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.cookies;
    if (Array.isArray(rows)) return Object.fromEntries(rows.filter(row => row?.name).map(row => [row.name, String(row.value || '')]));
  } catch { /* Cookie-header and Netscape formats are also supported. */ }
  if (text.includes('\t')) return Object.fromEntries(text.split(/\r?\n/)
    .filter(line => !line.startsWith('#') || line.startsWith('#HttpOnly_'))
    .map(line => line.split('\t')).filter(row => row.length >= 7).map(row => [row[5], row[6]]));
  return Object.fromEntries(text.split(';').map(item => item.trim()).filter(item => item.includes('='))
    .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]));
}

function sessionOwner(session) {
  return String(session || '').match(/^(\d+)(?:%3a|:)/i)?.[1] || '';
}

export function compareInstagramSessions(historical, env) {
  const old = cookieFields(historical);
  const current = cookieFields(env.INSTAGRAM_COOKIES);
  const standalone = String(env.INSTAGRAM_SESSIONID || '').trim();
  const sessions = [current.sessionid, standalone].filter(Boolean);
  const oldUser = old.ds_user_id || sessionOwner(old.sessionid);
  const currentUsers = [...new Set([current.ds_user_id, ...sessions.map(sessionOwner)].filter(Boolean))];
  const username = String(env.INSTAGRAM_USERNAME || '').trim().toLowerCase().replace(/^@/, '');
  return {
    networkRequests: 0,
    historicalSessionPresent: Boolean(old.sessionid),
    currentCookieConfigured: Boolean(current.sessionid),
    currentStandaloneConfigured: Boolean(standalone),
    exactHistoricalSessionStillConfigured: sessions.length && old.sessionid ? sessions.includes(old.sessionid) : null,
    currentSecretAccountMatchesHistorical: oldUser && currentUsers.length ? currentUsers.includes(oldUser) : null,
    currentCookieAccountsConsistent: currentUsers.length ? currentUsers.length === 1 : null,
    configuredLoginAccount: username === 'freefinder.at' ? 'freefinder' : username === 'dermarollerdesign' ? 'legacy-business' : username ? 'other' : 'not-configured',
    // A configured login name may differ from the owner of manually uploaded cookies.
    historicalAccountNameVerified: false,
    providerSessionValidity: 'not-tested',
    credentialsChanged: false,
    loginConfiguration: loginConfigurationAudit(env),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const historical = spawnSync('git', ['show', '1587805dca3d8a65ec5379fb1ccb968147fdc0c3:wien_deals/instagram_cookies.txt'], {encoding: 'utf8', maxBuffer: 65536});
  if (historical.status !== 0) throw new Error('Historical credential object unavailable; no comparison performed');
  console.log(JSON.stringify(compareInstagramSessions(historical.stdout, process.env), null, 2));
}
