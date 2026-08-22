import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'docs', 'meta-instagram-auth-health.json');
const STATE_PATH = path.join(ROOT, 'docs', 'meta-instagram-alert-state.json');
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value, max = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

export async function notifyMetaInstagramHealth(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const reportPath = options.reportPath || REPORT_PATH;
  const statePath = options.statePath || STATE_PATH;
  const env = options.env || process.env;
  const report = readJson(reportPath, {});
  const previous = readJson(statePath, {});
  const expiryStatus = cleanText(report?.tokenExpiry?.status, 40);
  const unhealthy = cleanText(report.status, 80) !== 'ok';
  const expiring = expiryStatus === 'expiring-soon' || expiryStatus === 'expired';

  if (!unhealthy && !expiring) {
    if (previous.activeKey) {
      writeJsonAtomic(statePath, {
        activeKey: '',
        recoveredAt: now.toISOString(),
        lastSentAt: previous.lastSentAt || '',
      });
    }
    return { sent: false, reason: 'healthy' };
  }

  const activeKey = [report.status, expiryStatus, report?.tokenExpiry?.expiresAt].map(cleanText).join('|');
  const lastSentAt = Date.parse(previous.lastSentAt || '');
  if (previous.activeKey === activeKey && Number.isFinite(lastSentAt) && now.getTime() - lastSentAt < DAY_MS) {
    return { sent: false, reason: 'deduplicated' };
  }

  const token = cleanText(env.SLACK_BOT_TOKEN, 1000);
  const channel = cleanText(env.SLACK_CHANNEL_ID, 200);
  if (!token || !channel) return { sent: false, reason: 'slack-not-configured' };

  const failedChecks = Array.isArray(report.checks)
    ? report.checks.filter((check) => !['ok', 'configured', 'skipped', 'unknown'].includes(cleanText(check?.status, 40)))
    : [];
  const lines = [
    '🚨 *Instagram Graph Health*',
    `Status: *${cleanText(report.status, 80) || 'unbekannt'}*`,
  ];
  if (report?.tokenExpiry?.expiresAt) {
    lines.push(`Token: ${Number(report.tokenExpiry.daysRemaining).toFixed(1)} Tage bis ${cleanText(report.tokenExpiry.expiresAt, 100)}`);
  }
  if (failedChecks.length) {
    lines.push(`Fehler: ${failedChecks.slice(0, 4).map((check) => `${cleanText(check.name, 80)}=${cleanText(check.status, 80)}`).join(', ')}`);
  }
  if (report.nextAction) lines.push(`Nächster Schritt: ${cleanText(report.nextAction, 500)}`);

  try {
    const response = await (options.fetchImpl || fetch)('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text: lines.join('\n') }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      console.log(`Meta Graph Slack alert could not be sent: ${cleanText(payload.error || response.status, 120)}`);
      return { sent: false, reason: 'slack-error' };
    }
    writeJsonAtomic(statePath, {
      activeKey,
      lastSentAt: now.toISOString(),
      reportStatus: cleanText(report.status, 80),
      tokenExpiryStatus: expiryStatus,
    });
    return { sent: true, reason: 'alerted' };
  } catch (error) {
    console.log(`Meta Graph Slack alert failed: ${cleanText(error?.message || error, 180)}`);
    return { sent: false, reason: 'network-error' };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  notifyMetaInstagramHealth().then((result) => {
    console.log(`Meta Instagram health notification: ${result.reason}`);
  });
}
