(() => {
  'use strict';
  const apple = 'https://apps.apple.com/app/id6758958213';
  const google = 'https://play.google.com/store/apps/details?id=com.stefanataalla.freefinderwien';
  const agent = navigator.userAgent || '';
  if (/bot|crawler|spider|facebookexternalhit/i.test(agent)) return;
  const android = /Android/i.test(agent);
  const ios = /iPhone|iPad|iPod/i.test(agent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!android && !ios) return;
  const destination = android ? google : apple;
  const primary = document.getElementById('primary-store');
  const alternative = document.getElementById('alternative-store');
  if (primary && alternative) {
    primary.href = destination;
    primary.textContent = android ? 'Für Android laden' : 'Für iPhone laden';
    alternative.href = android ? apple : google;
    alternative.textContent = android ? 'Für iPhone laden' : 'Für Android laden';
  }
  // Keep manual links usable if the browser refuses the automatic navigation.
  try { window.location.replace(destination); } catch {}
})();
