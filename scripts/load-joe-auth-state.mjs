import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = process.env.JOE_STORAGE_STATE || path.join(ROOT, '.secrets', 'joe.storage-state.json');
const encoded = process.env.JOE_STORAGE_STATE_B64 || '';

if (!encoded.trim()) {
  console.log('Kein JOE_STORAGE_STATE_B64 gesetzt, überspringe jö Auth-State-Setup.');
  process.exit(0);
}

try {
  const json = Buffer.from(encoded.trim(), 'base64').toString('utf8');
  JSON.parse(json);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, json);
  console.log(`jö Auth-State geschrieben: ${OUTPUT_PATH}`);
} catch (error) {
  console.error('Konnte JOE_STORAGE_STATE_B64 nicht dekodieren:', error.message);
  process.exit(1);
}
