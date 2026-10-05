(() => {
  const API = 'https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/merchant/promos';
  const $ = id => document.getElementById(id);
  let validatedCode = '';
  let validatedPackage = null;
  const packages = [
    { id: 'starter', name: 'Starter Boost', days: 1 },
    { id: 'spotlight', name: 'Spotlight Boost', days: 3 },
    { id: 'city', name: 'City Push', days: 8 },
  ];
  let pending = false;
  let attempt = null;
  const storageKey = 'freefinder-business-promo-attempt-v1';
  try { attempt = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
  if (!attempt || typeof attempt.requestId !== 'string' || typeof attempt.fingerprint !== 'string') attempt = null;
  const codeKey = value => value.trim().toUpperCase().replace(/[\s-]/g, '');
  function status(id, message, error = false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
  async function post(path, payload) {
    let response;
    try { response = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('Verbindung unterbrochen. Bitte erneut versuchen. Deine Angaben bleiben erhalten.'); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Momentan nicht verfügbar. Bitte erneut versuchen.');
    return result;
  }
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('code')) {
    $('code').value = fragment.get('code').slice(0, 60);
    history.replaceState(null, '', location.pathname + location.search);
  }
  $('code').addEventListener('input', () => {
    if (pending) return;
    validatedCode = ''; validatedPackage = null; $('consent').checked = false;
    $('editor').hidden = true; status('code-status', '');
  });
  $('code-form').addEventListener('submit', async event => {
    event.preventDefault(); if (pending) return;
    pending = true; $('check').disabled = true; $('code').readOnly = true;
    status('code-status', 'Code wird geprüft …');
    try {
      const code = codeKey($('code').value);
      const result = await post('check', { code });
      const pack = packages.find(item => item.id === result.package?.id && item.days === result.package?.durationDays);
      if (!pack || result.amount !== 0 || result.currency !== 'EUR') throw new Error('Dieser Code enthält kein unterstütztes kostenloses Business-Paket.');
      validatedPackage = pack;
      validatedCode = code;
      $('offer-name').textContent = pack.name;
      $('offer-period').textContent = `${pack.days * 24} Stunden ab Aktivierung`;
      $('offer-expiry').textContent = `Die Anzeige endet nach ${pack.days * 24} Stunden.`;
      $('activate').textContent = `${pack.name} kostenlos aktivieren`;
      $('restaurant').value = result.restaurantName || $('restaurant').value;
      $('restaurant').readOnly = Boolean(result.restaurantName);
      $('editor').hidden = false;
      status('code-status', `Code gültig. ${pack.name} · ${pack.days} ${pack.days === 1 ? 'Tag' : 'Tage'} · 0 €.`);
      updatePreview(); $('restaurant').focus();
    } catch (error) { validatedCode = ''; validatedPackage = null; $('editor').hidden = true; status('code-status', error.message, true); }
    finally { pending = false; $('check').disabled = false; $('code').readOnly = false; }
  });
  function updatePreview() {
    for (const [input, preview, fallback] of [['restaurant', 'preview-restaurant', 'Dein Restaurant'], ['title', 'preview-title', 'Dein Angebot'], ['details', 'preview-description', 'Details und Bedingungen'], ['address', 'preview-address', 'Adresse']]) {
      $(preview).textContent = $(input).value.trim() || fallback;
    }
    $('preview-price').textContent = [$('old-price').value && `Normalpreis: ${$('old-price').value}`, $('deal-price').value && `Dealpreis: ${$('deal-price').value}`].filter(Boolean).join(' · ');
    $('count').textContent = `${$('details').value.length} / 360`;
  }
  $('ad-form').addEventListener('input', updatePreview);
  $('ad-form').addEventListener('submit', async event => {
    event.preventDefault(); if (pending) return;
    if (!validatedPackage || !validatedCode || validatedCode !== codeKey($('code').value)) { status('ad-status', 'Bitte zuerst den Promo-Code prüfen.', true); return; }
    if (!$('consent').checked || !$('ad-form').reportValidity()) return;
    const draft = Object.fromEntries(new FormData($('ad-form')));
    for (const key of Object.keys(draft)) draft[key] = draft[key].trim();
    draft.acceptedTerms = true;
    pending = true; $('activate').disabled = true; $('check').disabled = true; $('code').readOnly = true;
    status('ad-status', 'Anzeige wird aktiviert …');
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ code: validatedCode, ...draft })));
      const fingerprint = Array.from(new Uint8Array(bytes)).map(v => v.toString(16).padStart(2, '0')).join('');
      if (attempt?.fingerprint !== fingerprint) {
        attempt = { fingerprint, requestId: crypto.randomUUID() };
        try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); } catch {}
      }
      const result = await post('redeem', { ...draft, code: validatedCode, requestId: attempt.requestId });
      const receipt = result.campaign;
      if (!receipt?.id || receipt.packageId !== validatedPackage.id || receipt.amount !== 0 || receipt.currency !== 'EUR'
          || !Number.isFinite(receipt.startsAt) || receipt.startsAt <= 0 || !Number.isFinite(receipt.endsAt)
          || receipt.endsAt - receipt.startsAt !== validatedPackage.days * 86400000) {
        throw new Error('Die kostenlose Anzeige konnte nicht bestätigt werden. Bitte unverändert erneut versuchen.');
      }
      $('editor').hidden = true; $('code-form').hidden = true; $('success').hidden = false;
      status('code-status', 'Code eingelöst.');
      $('receipt-title').textContent = `${result.campaign.restaurantName}: ${result.campaign.dealTitle}`;
      const date = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Vienna' });
      $('receipt-period').textContent = `Laufzeit: ${date.format(result.campaign.startsAt)} bis ${date.format(result.campaign.endsAt)} (Wien).`;
      $('success').focus();
    } catch (error) { status('ad-status', error.message, true); }
    finally { pending = false; $('activate').disabled = false; $('check').disabled = false; $('code').readOnly = false; }
  });
})();
