(() => {
  const form = document.querySelector('.deal-filters');
  const grid = document.getElementById('dealGrid');
  if (!form || !grid) return;
  const cards = [...grid.querySelectorAll('.live-deal-card')];
  const search = document.getElementById('dealSearch');
  const district = document.getElementById('dealDistrict');
  const sort = document.getElementById('dealSort');
  const count = document.getElementById('dealCount');
  const empty = document.getElementById('dealEmpty');
  const reset = form.querySelector('[type="reset"]');
  const buttons = [...form.querySelectorAll('[data-deal-type]')];
  const viennaDay = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const normalize = value => value.toLocaleLowerCase('de-AT').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const searchable = new Map(cards.map(card => [card, normalize(card.textContent)]));
  let type = 'all';

  function update() {
    const terms = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    const now = Date.now();
    const parts = Object.fromEntries(viennaDay.formatToParts(now).map(({ type, value }) => [type, value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const available = { all: 0 };
    let visible = 0;
    for (const card of cards) {
      const active = card.dataset.expiryDay ? card.dataset.expiryDay >= today : Number(card.dataset.expiry) >= now;
      if (active) {
        available.all++;
        available[card.dataset.type] = (available[card.dataset.type] || 0) + 1;
      }
      const matches = active && (type === 'all' || card.dataset.type === type)
        && (district.value === 'all' || card.dataset.districts.split(' ').includes(district.value))
        && terms.every(term => searchable.get(card).includes(term));
      card.hidden = !matches;
      if (matches) visible++;
    }
    const ordered = [...cards].sort((a, b) => {
      if (sort.value === 'ending') return Number(a.dataset.expiry) - Number(b.dataset.expiry) || Number(a.dataset.order) - Number(b.dataset.order);
      if (sort.value === 'brand') return a.querySelector('.live-deal-brand').textContent.localeCompare(b.querySelector('.live-deal-brand').textContent, 'de-AT') || Number(a.dataset.order) - Number(b.dataset.order);
      return Number(a.dataset.order) - Number(b.dataset.order);
    });
    for (const card of ordered) grid.appendChild(card);
    count.textContent = `${visible} ${visible === 1 ? 'Deal' : 'Deals'}`;
    empty.hidden = visible !== 0 || cards.length === 0;
    reset.hidden = !search.value && district.value === 'all' && type === 'all' && sort.value === 'recommended';
    for (const button of buttons) {
      const buttonType = button.dataset.dealType;
      button.querySelector('span').textContent = available[buttonType] || 0;
      button.disabled = buttonType !== 'all' && !available[buttonType];
      button.setAttribute('aria-pressed', String(buttonType === type));
    }
  }

  form.addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', update);
  district.addEventListener('change', update);
  sort.addEventListener('change', update);
  for (const button of buttons) button.addEventListener('click', () => { type = button.dataset.dealType; update(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    search.value = '';
    district.value = 'all';
    sort.value = 'recommended';
    type = 'all';
    update();
  });
  document.querySelector('[data-reset-filters]').addEventListener('click', () => {
    form.reset();
    search.focus();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) update(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  form.hidden = false;
  update();
})();
