(() => {
  'use strict';
  const query = new URLSearchParams(location.search);
  const code = query.get('invite');
  const status = document.querySelector('#status');
  if (query.getAll('invite').length !== 1 || !/^RM-[A-F0-9]{24}$/.test(code || '')) {
    status.textContent = 'Dieser Einladungslink ist ungültig.'; return;
  }
  const params = new URLSearchParams({ invite: code });
  const deal = query.get('deal');
  if (deal && /^[a-zA-Z0-9_-]{1,160}$/.test(deal)) params.set('deal', deal);
  const android = /Android/i.test(navigator.userAgent);
  const iphone = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const storeURL = android
    ? 'https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien&referrer=' + encodeURIComponent(params.toString())
    : 'https://apps.apple.com/app/id6758958213';
  document.querySelector('#store').href = storeURL;
  document.querySelector('#open').href = 'freefinder://invite?' + params.toString();
  fetch('https://freefinder-merchant-backend.freefinder-stefan.workers.dev/api/referral-months/config',
    { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(7000) })
    .then(response => { if (!response.ok) throw Error(); return response.json(); })
    .then(config => {
      if (config.enabled !== true) { status.textContent = 'Die Einladungsaktion ist noch nicht verfügbar.'; return; }
      document.querySelector('#invitation').hidden = false;
      status.textContent = 'Dein Einladungslink bleibt erhalten.';
      // Universal/App Links open an installed app before this page. No click creates a reward.
      if ((android || iphone) && !sessionStorage.getItem('freefinder-invite-store:' + code)) {
        sessionStorage.setItem('freefinder-invite-store:' + code, '1');
        location.replace(storeURL);
      }
    }).catch(() => { status.textContent = 'Die Einladung konnte gerade nicht geprüft werden. Bitte erneut öffnen.'; });
})();
