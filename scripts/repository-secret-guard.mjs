import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const forbiddenPath = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$)[^/]+)?|\.secrets|\.community-internal)(?:\/|$)|(?:^|\/)(?:instagram[_-]?cookies\.(?:txt|json)|instagram\.cookies|[^/]+\.storage-state\.json)$/i;
const sessionValue = '[0-9]{5,}(?:%3[aA]|:)[A-Za-z0-9%:_-]{12,}';

// Report only the class and file, never matched credential bytes.
export function publicationSecretFindings(file, content) {
  const findings = [];
  if (forbiddenPath.test(file)) findings.push('private-runtime-path');
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content || '');
  if (new RegExp(`(?:sessionid["']?\\s*[:=]\\s*["']?|sessionid\\t)${sessionValue}`, 'i').test(text)
      || new RegExp(`["']name["']\\s*:\\s*["']sessionid["'][^{}]{0,1500}["']value["']\\s*:\\s*["']${sessionValue}`, 'i').test(text)
      || new RegExp(`["']value["']\\s*:\\s*["']${sessionValue}[^{}]{0,1500}["']name["']\\s*:\\s*["']sessionid["']`, 'i').test(text)) {
    findings.push('instagram-session-cookie');
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{100,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    findings.push('private-key');
  }
  return findings;
}

export function assertPublicationSafe(states) {
  const issues = states.filter(row => row?.exists !== false).flatMap(row =>
    publicationSecretFindings(row.path, row.content).map(kind => `${row.path}: ${kind}`));
  if (issues.length) throw new Error(`Private data must not be published:\n${issues.join('\n')}`);
}

export function scanTrackedTree(root = process.cwd()) {
  const result = spawnSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error('Cannot enumerate tracked repository files');
  let scanned = 0;
  const issues = [];
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    const absolute = `${root}/${file}`;
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) continue;
    const isText = /\.(?:json|jsonl|txt|md|mjs|js|ts|yml|yaml|env|pem|key|csv|html|toml|py|rb|sh)$|(?:^|\/)\.env/.test(file);
    const content = isText ? fs.readFileSync(absolute) : '';
    scanned++;
    for (const kind of publicationSecretFindings(file, content)) issues.push({file, kind});
  }
  return {scanned, issues};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scanTrackedTree();
  console.log(JSON.stringify(result, null, 2));
  if (result.issues.length) process.exitCode = 1;
}
