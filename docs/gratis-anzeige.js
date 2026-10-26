(() => {
  const button = document.getElementById('copy-code');
  const input = document.getElementById('promo-code');
  const status = document.getElementById('copy-status');
  if (!button || !input || !status) return;
  button.addEventListener('click', async () => {
    if (!navigator.clipboard?.writeText) {
      status.textContent = 'Bitte den Code markieren und manuell kopieren oder in der App eingeben.';
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      status.textContent = 'Code kopiert. Du kannst ihn in der App unter Business-Anzeigen einfügen.';
    } catch {
      status.textContent = 'Kopieren nicht erlaubt. Du kannst SPOTLIGHTGRATIS auch direkt in der App eingeben.';
    }
  });
})();
