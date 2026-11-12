import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function inspectCouponTools(run = spawnSync, { includePdf = true } = {}) {
  const packages = new Set();
  const tools = {};
  for (const [tool, args, pkg] of [
    ['ffmpeg', ['-version'], 'ffmpeg'], ['ffprobe', ['-version'], 'ffmpeg'], ['pdfimages', ['-v'], 'poppler-utils'],
    ['pdfinfo', ['-v'], 'poppler-utils'], ['pdftotext', ['-v'], 'poppler-utils'],
    ['tesseract', ['--version'], 'tesseract-ocr'],
  ]) {
    if (!includePdf && pkg === 'poppler-utils') continue;
    tools[tool] = run(tool, args, { timeout: 3000, encoding: 'utf8', stdio: 'pipe' }).status === 0;
    if (!tools[tool]) packages.add(pkg);
  }
  const langs = tools.tesseract ? run('tesseract', ['--list-langs'], { timeout: 3000, encoding: 'utf8' }).stdout || '' : '';
  for (const lang of ['deu', 'eng']) if (!String(langs).split(/\r?\n/).includes(lang)) packages.add(`tesseract-ocr-${lang}`);
  return { available: packages.size === 0, packages: [...packages], tools };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = inspectCouponTools(spawnSync, { includePdf: !process.argv.includes('--instagram') });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `available=${result.available}\npackages=${result.packages.join(' ')}\n`);
  if (process.argv.includes('--require') && !result.available) process.exitCode = 1;
}
