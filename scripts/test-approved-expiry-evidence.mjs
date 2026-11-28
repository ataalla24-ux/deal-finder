import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureApprovedExpiryEvidence, readApprovedExpiryEvidence } from './approved-expiry-evidence.mjs';

const now = new Date('2026-11-27T21:00:00.000Z');
const deal = { id: 'tiktok-original', brand: 'Cafe Wien',
  url: 'https://www.tiktok.com/@cafewien/video/7710635479883992342',
  title: 'Gratis Kaffee', description: 'Editorial copy is not original evidence.',
  validFrom: '2026-11-27', validOn: '2026-11-27', validUntil: '2026-11-27',
  expires: '2026-11-27T18:00:00.000Z', expiryKind: 'single',
  expiresOriginal: '27.11.2026, 15:00 bis 27.11.2026, 19:00 Uhr',
  sourcePublishedAt: '2026-11-21T14:43:41.000Z', sourcePublishedAtSource: 'url.tiktokVideoId',
  approvedAt: '2026-11-24T11:28:41.247Z',
  pipelineLifecycle: { manualDecision: 'approved', manualDecisionAt: '2026-11-24T11:28:41.000Z' } };
const original = '🎉 Am 27.11.2026 von 15:00 bis 19:00 Uhr: Gratis Kaffee!\nNur bei Cafe Wien.';
const capture = (record = deal, options = {}) => captureApprovedExpiryEvidence(record, {
  sourceText: original, sourceUrl: deal.url, verifiedAt: '2026-11-24T11:28:00.000Z', now, ...options });
const withReceipt = (record = deal) => ({ ...record, approvedExpiryEvidence: capture(record) });

test('preserves complete original text with exact period, source and real approval binding', () => {
  const record = withReceipt();
  const receipt = readApprovedExpiryEvidence(record, { now });
  assert.equal(receipt.sourceText, original);
  assert.equal(receipt.sourceUrl, deal.url);
  assert.equal(receipt.period.expires, deal.expires);
  assert.equal(receipt.approvedAt, deal.approvedAt);
  assert.match(receipt.sourceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(record.expires, deal.expires);
});

test('does not promote displayed copy or arbitrary missing inputs into source evidence', () => {
  assert.equal(capture(deal, { sourceText: undefined }), null);
  for (const options of [{ sourceText: '' }, { sourceText: '   ' }, { sourceText: original + '\u0000' },
    { sourceText: 'x'.repeat(16001) },
    { verifiedAt: '' }, { verifiedAt: '2026-11-24' }, { verifiedAt: '2026-11-28T00:00:00Z' },
    { sourceUrl: 'https://www.tiktok.com/@someoneelse/video/123' }, { sourceUrl: 'http://www.tiktok.com/@cafewien/video/7710635479883992342' }]) {
    assert.equal(capture(deal, options), null, JSON.stringify(options));
  }
  assert.equal(capture({ ...deal, approvedAt: '', pipelineLifecycle: {} }), null);
  assert.equal(capture({ ...deal, pipelineLifecycle: { ...deal.pipelineLifecycle, manualDecision: 'rejected' } }), null);
});

test('identity, original source, approval and period changes invalidate the receipt', () => {
  const record = withReceipt();
  for (const patch of [{ id: 'other' }, { brand: 'Other Cafe' }, { url: 'https://example.com/other' },
    { evidencePostUrl: 'https://www.instagram.com/p/Other/' }, { approvedAt: '2026-11-25T11:28:41.247Z' },
    { validUntil: '2026-11-28' }, { validOn: null }, { validFrom: '' }, { expires: '2026-11-28T18:00:00Z' },
    { expiresOriginal: 'Verlängert' }, { expiryKind: 'start' }, { expirySource: 'manual' },
    { sourcePublishedAt: '2026-11-22T14:43:41.000Z' }, { sourcePublishedAtSource: 'guessed-date' },
    { pipelineLifecycle: { ...deal.pipelineLifecycle, manualDecisionAt: '2026-11-25T11:28:41.000Z' } }]) {
    assert.equal(readApprovedExpiryEvidence({ ...record, ...patch }, { now }), null, JSON.stringify(patch));
  }
});

test('receipt tampering or corrupted version is rejected; editor-only copy changes remain valid', () => {
  const record = withReceipt();
  for (const patch of [{ version: 2 }, { sourceText: original + ' And tomorrow.' }, { verifiedAt: '2026-11-25T11:28:00Z' },
    { sourceHash: 'f'.repeat(64) }, { bindingHash: 'f'.repeat(64) }, { brand: 'Other Cafe' }, { period: {} }]) {
    assert.equal(readApprovedExpiryEvidence({ ...record, approvedExpiryEvidence: { ...record.approvedExpiryEvidence, ...patch } }, { now }), null);
  }
  assert.ok(readApprovedExpiryEvidence({ ...record, title: 'Reviewed concise title', description: 'Reviewed concise copy', votes: 12 }, { now }));
});

test('optional undefined period fields do not invalidate a receipt or invent evidence', () => {
  const record = withReceipt();
  assert.ok(capture({ ...deal, validityText: undefined, expirySource: undefined }));
  assert.ok(readApprovedExpiryEvidence({ ...record, validityText: undefined }, { now }));
  assert.equal(capture({ ...deal, sourcePublishedAt: 'not-a-date' }), null);
  assert.equal(capture({ ...deal, sourcePublishedAtSource: {} }), null);
  assert.equal(readApprovedExpiryEvidence({ ...record, approvedExpiryEvidence: {
    ...record.approvedExpiryEvidence, sourcePublishedAt: '2026-11-22T14:43:41.000Z' } }, { now }), null);
});

test('canonical post decoration preserves original identity without accepting login pages or other posts', () => {
  const instagram = { ...deal, id: 'ig-original', url: 'https://instagram.com/reel/AbCdEf123/?utm_source=test' };
  const receipt = capture(instagram, { caption: original, sourceText: undefined,
    sourceUrl: 'https://www.instagram.com/p/AbCdEf123/' });
  assert.ok(receipt);
  assert.equal(receipt.sourceUrl, 'https://www.instagram.com/p/AbCdEf123/');
  assert.ok(readApprovedExpiryEvidence({ ...instagram, url: receipt.sourceUrl, approvedExpiryEvidence: receipt }, { now }));
  assert.equal(capture(instagram, { sourceUrl: 'https://www.instagram.com/p/abcdef123/' }), null);
  for (const url of ['https://instagram.com/accounts/login/?next=/p/AbCdEf123/',
    'https://secret@instagram.com/p/AbCdEf123/', 'https://instagram.com:444/p/AbCdEf123/',
    'https://www.tiktok.com/@cafewien', 'not-a-url']) assert.equal(capture({ ...deal, url }, { sourceUrl: url }), null);
});

test('a later actual source review preserves old human approval without inventing a new approval', () => {
  const receipt = capture(deal, { verifiedAt: now.toISOString() });
  assert.equal(receipt.verifiedAt, now.toISOString());
  assert.equal(receipt.approvedAt, deal.approvedAt);
  const legacy = { ...deal, approvedAt: undefined };
  assert.ok(capture(legacy));
});

const couponPage = 'https://www.nordsee.com/at/coupons';
const couponPdf = `${couponPage}/pdf`;
const pdfDeal = { id: 'reviewed-nordsee-coupon', brand: 'NORDSEE', url: couponPage,
  approvedAt: '2026-11-20T10:00:00.000Z', expiryKind: 'end', validUntil: '2026-11-30',
  expires: '2026-11-30T23:59:59.999Z', expiresOriginal: 'Gültig bis 30.11.2026' };
const pdfSource = 'Gültig bis 30.11.2026 in teilnehmenden Restaurants. Nicht an Autobahnraststätten.';
const pdfBytes = Buffer.from('%PDF-1.7\n% Explicit offline document fixture\n%%EOF\n');
const linkedDocument = { pageUrl: couponPage, pageFinalUrl: couponPage, pageHttpStatus: 200,
  pageHtml: `<html><head><link rel="canonical" href="${couponPage}"></head><body><a href="/at/coupons/pdf">Alle Gutscheine herunterladen</a></body></html>`,
  documentFinalUrl: couponPdf, documentHttpStatus: 200, documentContentType: 'application/pdf', documentBytes: pdfBytes };
const capturePdf = (record = pdfDeal, options = {}) => captureApprovedExpiryEvidence(record, {
  sourceText: pdfSource, sourceUrl: couponPdf, verifiedAt: now.toISOString(), now,
  linkedDocument, ...options });
const sha = value => createHash('sha256').update(value).digest('hex');

test('an explicitly linked reviewed PDF retains its real URL, byte hash and parent-page proof separately', () => {
  const receipt = capturePdf();
  assert.ok(receipt);
  assert.equal(receipt.sourceUrl, couponPdf);
  assert.equal(receipt.sourceText, pdfSource);
  assert.equal(receipt.approvedAt, pdfDeal.approvedAt);
  assert.equal(receipt.linkedDocument.pageUrl, couponPage);
  assert.equal(receipt.linkedDocument.documentSha256, sha(pdfBytes));
  assert.equal(receipt.linkedDocument.documentBytes, pdfBytes.length);
  assert.equal(receipt.linkedDocument.pageHtmlHash, sha(linkedDocument.pageHtml));
  assert.equal(receipt.linkedDocument.linkHref, '/at/coupons/pdf');
  assert.equal(receipt.period.validUntil, pdfDeal.validUntil);
  assert.deepEqual(readApprovedExpiryEvidence({ ...pdfDeal, approvedExpiryEvidence: receipt }, { now }), receipt);
  assert.ok(!JSON.stringify(receipt).includes('Explicit offline document fixture'));
  assert.equal(capturePdf(pdfDeal, { linkedDocument: undefined }), null);
  assert.equal(capturePdf(pdfDeal, { sourceUrl: couponPage }), null, 'PDF text must not claim parent HTML as its source');
});

test('the PDF exception cannot attach arbitrary documents, redirects, login pages or external origins', () => {
  for (const patch of [
    { pageUrl: 'https://www.nordsee.com/at/other' }, { pageFinalUrl: 'https://www.nordsee.com/login' },
    { documentFinalUrl: 'https://www.nordsee.com/login' }, { documentFinalUrl: 'https://cdn.example.com/coupon.pdf' },
    { documentFinalUrl: 'https://www.nordsee.com/at/coupons/other.pdf' },
    { pageFinalUrl: 'http://www.nordsee.com/at/coupons' }, { documentFinalUrl: 'https://user@www.nordsee.com/at/coupons/pdf' },
    { documentFinalUrl: 'https://www.nordsee.com:8443/at/coupons/pdf' },
    { pageHttpStatus: 302 }, { documentHttpStatus: 403 }, { documentContentType: 'text/html' },
  ]) assert.equal(capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument, ...patch } }), null, JSON.stringify(patch));
  assert.equal(capturePdf({ ...pdfDeal, url: 'https://example.com/offer' }, {
    sourceUrl: 'https://example.com/offer.pdf', linkedDocument: { ...linkedDocument,
      pageUrl: 'https://example.com/offer', pageFinalUrl: 'https://example.com/offer',
      documentFinalUrl: 'https://example.com/offer.pdf', pageHtml: '<a href="/offer.pdf">PDF</a>' } }), null);
});

test('only a real parent anchor proves the link; script, comments, base and canonical substitution fail', () => {
  for (const pageHtml of [
    '<html>https://www.nordsee.com/at/coupons/pdf</html>',
    '<script>const link = \'<a href="/at/coupons/pdf">PDF</a>\';</script>',
    '<!-- <a href="/at/coupons/pdf">PDF</a> -->',
    '<template><a href="/at/coupons/pdf">PDF</a></template>',
    '<noscript><a href="/at/coupons/pdf">PDF</a></noscript>',
    '<a href="https://other.example/at/coupons/pdf">PDF</a>',
    '<base href="https://other.example"><a href="/at/coupons/pdf">PDF</a>',
    '<link rel="canonical" href="https://www.nordsee.com/login"><a href="/at/coupons/pdf">PDF</a>',
    '<title>Login</title><form><input type="password"></form><a href="/at/coupons/pdf">PDF</a>',
    '<title>Coupons</title><form><input type="password"></form><a href="/at/coupons/pdf">PDF</a>',
    '<title>Access denied</title><a href="/at/coupons/pdf">PDF</a>',
  ]) assert.equal(capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument, pageHtml } }), null, pageHtml);
  assert.ok(capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument,
    pageHtml: `<a href="/login">Login</a><a href="${couponPdf}">Offizielles PDF</a>` } }));
});

test('linked-document capture hashes actual bounded PDF bytes rather than trusting a supplied hash', () => {
  for (const documentBytes of [undefined, '%PDF-1.7', Buffer.from('<html>Login required</html>'), new Uint8Array(20_000_001)]) {
    assert.equal(capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument, documentBytes } }), null);
  }
  const receipt = capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument, documentSha256: 'f'.repeat(64) } });
  assert.equal(receipt.linkedDocument.documentSha256, sha(pdfBytes));
  assert.equal(capturePdf(pdfDeal, { linkedDocument: { ...linkedDocument, pageHtml: 'x'.repeat(1_000_001) } }), null);
});

test('PDF receipt rejects document, parent, original approval and final-period changes after capture', () => {
  const receipt = capturePdf();
  const read = (record, evidence = receipt) => readApprovedExpiryEvidence({ ...record, approvedExpiryEvidence: evidence }, { now });
  for (const patch of [{ id: 'another-coupon' }, { brand: 'Another merchant' }, { url: couponPdf },
    { approvedAt: '2026-11-21T10:00:00Z' }, { validUntil: '2026-12-31' }, { expires: '2026-12-31T23:59:59.999Z' }]) {
    assert.equal(read({ ...pdfDeal, ...patch }), null, JSON.stringify(patch));
  }
  for (const patch of [{ pageHtmlHash: 'f'.repeat(64) }, { documentSha256: 'f'.repeat(64) },
    { pageUrl: couponPdf }, { documentUrl: couponPage }, { linkHref: '/login' }, { documentBytes: pdfBytes.length + 1 }]) {
    assert.equal(read(pdfDeal, { ...receipt, linkedDocument: { ...receipt.linkedDocument, ...patch } }), null);
  }
  assert.equal(read(pdfDeal, { ...receipt, sourceUrl: couponPage }), null);
  assert.equal(read(pdfDeal, { ...receipt, linkedDocument: undefined }), null);
  assert.equal(read(pdfDeal, { ...receipt, sourceText: pdfSource + ' Verlängert.' }), null);
  assert.ok(read({ ...pdfDeal, title: 'Edited coupon title', description: 'Edited readable copy' }));
  assert.ok(capturePdf({ ...pdfDeal, validUntil: '2026-12-01' }), 'caller can capture again only after validating the new period against the source');
});

const imagePost = 'https://www.instagram.com/p/DgLPXp-xxSu/';
const imageCaption = 'OUR SATURDAY PLAN This Saturday: Free Tasting of Thai tea!';
const imageOcr = 'Sat 28 November\n10:00-12:00\nMAISONNAYA';
const imageDeal = { id: 'meta-ig-18126514285942800', brand: 'Maisonnayavienna', url: imagePost,
  approvedAt: '2026-11-26T09:37:28.324Z', sourcePublishedAt: '2026-11-25T19:05:15.000Z',
  sourcePublishedAtSource: 'url.instagramShortcode', expiryKind: 'end', validUntil: '2026-11-28',
  expires: '2026-11-28T11:00:00.000Z', ownerUsername: 'maisonnayavienna', merchantUsername: 'maisonnayavienna',
  sourceAccountType: 'merchant', metaGraphVerified: true, metaGraphVerifiedAt: '2026-11-25T23:39:46.593Z',
  metaGraphAccepted: false, metaGraphRejection: 'missing-vienna-evidence', metaGraphMediaId: '18126514285942800',
  metaGraphCaption: imageCaption, metaGraphOcrText: 'Sat 28 November 10:00-12:00 MAISONNAYA',
  evidence: { mediaId: '18126514285942800', username: 'maisonnayavienna',
    mediaEvidence: { ocrText: 'Sat 28 November 10:00-12:00 MAISONNAYA' } } };
const imageUrl = 'https://scontent-vie1-1.cdninstagram.com/v/t51.82787-15/original.jpg?checked=fixture';
const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]); // Explicit offline byte fixture.
const originalMedia = { pageUrl: imagePost, pageFinalUrl: imagePost, pageHttpStatus: 200,
  pageHtml: `<meta property="og:image" content="${imageUrl}"><meta property="og:description" content="maisonnayavienna on November 25, 2026: ${imageCaption}">`,
  imageUrl, imageHttpStatus: 200, imageBytes, imageCheckedAt: now.toISOString(),
  reviewMethod: 'visual-original-image', caption: imageCaption, ocrText: imageOcr };
const captureImage = (record = imageDeal, options = {}) => captureApprovedExpiryEvidence(record, {
  sourceText: imageCaption, sourceUrl: imagePost, verifiedAt: now.toISOString(), now, originalMedia, ...options });

test('reviewed original image keeps the literal caption and visual transcription separate without changing Graph acceptance', () => {
  const receipt = captureImage();
  assert.ok(receipt);
  assert.equal(receipt.sourceText, imageCaption);
  assert.equal(receipt.originalMedia.caption, imageCaption);
  assert.equal(receipt.originalMedia.ocrText, imageOcr);
  assert.equal(receipt.originalMedia.imageSha256, sha(imageBytes));
  assert.equal(receipt.originalMedia.captionHash, sha(imageCaption));
  assert.equal(receipt.originalMedia.ocrHash, sha(imageOcr));
  assert.equal(receipt.originalMedia.originalCaptionHash, sha(imageDeal.metaGraphCaption));
  assert.equal(receipt.originalMedia.retainedOcrHash, sha(imageDeal.metaGraphOcrText));
  assert.equal(receipt.originalMedia.graphAccepted, false);
  assert.equal(imageDeal.metaGraphAccepted, false);
  assert.equal(receipt.approvedAt, imageDeal.approvedAt);
  assert.deepEqual(readApprovedExpiryEvidence({ ...imageDeal, approvedExpiryEvidence: receipt }, { now }), receipt);
});

test('original image exception requires exact reviewed post, merchant, approval and nonblocking rejection', () => {
  for (const patch of [{ id: 'another' }, { url: 'https://www.instagram.com/p/Other/' },
    { ownerUsername: 'other' }, { merchantUsername: 'other' }, { metaGraphMediaId: '123456789012345' },
    { metaGraphAccepted: true }, { metaGraphVerified: false }, { metaGraphRejection: 'withdrawn' },
    { metaGraphBlockingReason: 'post-unavailable' }, { metaGraphIsRepost: true },
    { approvedAt: '' }, { sourcePublishedAt: '2026-11-24T19:05:15Z' },
    { metaGraphCaption: imageCaption + ' Extended.' }, { metaGraphOcrText: '29 November 10:00-12:00' },
    { evidence: { ...imageDeal.evidence, mediaId: 'another' } }]) {
    assert.equal(captureImage({ ...imageDeal, ...patch }), null, JSON.stringify(patch));
  }
});

test('original image proof requires actual OG association and bounded JPEG bytes, not arbitrary URLs or supplied hashes', () => {
  for (const patch of [{ pageFinalUrl: 'https://www.instagram.com/accounts/login/' }, { pageHttpStatus: 403 },
    { imageUrl: 'https://example.com/original.jpg' }, { imageHttpStatus: 302 }, { reviewMethod: 'unreviewed-ocr' },
    { imageCheckedAt: '2026-11-29T12:00:00Z' }, { imageBytes: Buffer.from('not a JPEG') },
    { caption: imageCaption + ' more' }, { ocrText: '' }, { ocrText: {} },
    { pageHtml: `<a href="${imageUrl}">Image</a>` },
    { pageHtml: originalMedia.pageHtml.replace('maisonnayavienna on', 'someoneelse on') },
    { pageHtml: originalMedia.pageHtml.replace('November 25, 2026', 'November 24, 2026') },
    { pageHtml: originalMedia.pageHtml.replace('original.jpg', 'different.jpg') },
    { pageHtml: '<link rel="canonical" href="https://www.instagram.com/p/Other/">' + originalMedia.pageHtml },
    { pageHtml: '<title>Login</title><form><input type="password"></form>' + originalMedia.pageHtml },
    { pageHtml: '<script>' + originalMedia.pageHtml + '</script>' }]) {
    assert.equal(captureImage(imageDeal, { originalMedia: { ...originalMedia, ...patch } }), null, JSON.stringify(patch));
  }
  assert.equal(captureImage(imageDeal, { originalMedia: { ...originalMedia, imageSha256: 'f'.repeat(64) } })
    .originalMedia.imageSha256, sha(imageBytes));
});

test('image receipt changes to bytes proof, transcription, caption, owner, original clocks or final period invalidate read', () => {
  const receipt = captureImage();
  const read = (row, proof = receipt) => readApprovedExpiryEvidence({ ...row, approvedExpiryEvidence: proof }, { now });
  for (const patch of [{ ownerUsername: 'other' }, { metaGraphAccepted: true }, { metaGraphRejection: 'other' },
    { metaGraphVerifiedAt: '2026-11-26T01:00:00Z' }, { sourcePublishedAt: '2026-11-25T19:05:20Z' },
    { metaGraphCaption: imageCaption + ' ' }, { metaGraphOcrText: imageOcr },
    { approvedAt: '2026-11-26T10:00:00Z' }, { expires: '2026-11-28T12:00:00Z' }]) assert.equal(read({ ...imageDeal, ...patch }), null);
  for (const patch of [{ imageSha256: 'f'.repeat(64) }, { pageHtmlHash: 'f'.repeat(64) },
    { ocrText: 'Sat 28 November\n10:00-13:00\nMAISONNAYA' }, { caption: imageCaption + ' Extra.' },
    { ownerUsername: 'other' }, { imageUrl: imageUrl + '&changed=1' }, { imageCheckedAt: '2026-11-27T20:00:00Z' }]) {
    assert.equal(read(imageDeal, { ...receipt, originalMedia: { ...receipt.originalMedia, ...patch } }), null);
  }
  assert.equal(read(imageDeal, { ...receipt, originalMedia: undefined }), null);
  assert.ok(read({ ...imageDeal, description: 'Reviewed concise copy', votes: 12 }));
});
