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
  const normalize = value => value.toLocaleLowerCase('de-AT').replace(/ß/g, 'ss')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const searchable = new Map(cards.map(card => [card, normalize(card.textContent)]));
  let type = 'all';

  function update() {
    const terms = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      const matches = (type === 'all' || card.dataset.type === type)
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
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.dealType === type));
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
  form.hidden = false;
  update();
})();
