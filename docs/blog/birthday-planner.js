// Calendar dates only: UTC arithmetic keeps Vienna's clock changes out of the windows.
export function birthdayWindows(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900 || Number(value.slice(0, 4)) > 2099) return null;
  const birthday = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== value) return null;
  const offset = days => {
    const date = new Date(birthday);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return [
    { name: 'Madame Tussauds', start: value, end: value },
    { name: '3D PicArt Museum', start: value, end: value },
    { name: 'Watertuin', start: offset(birthday.getUTCDay() === 2 ? 1 : 0), end: offset(birthday.getUTCDay() === 2 ? 2 : 0) },
    { name: 'Donauturm', start: offset(-2), end: offset(2) },
    { name: 'Balls&Clubs', start: offset(-7), end: offset(7) },
    { name: 'Cineplexx Kindergeburtstag', start: offset(-14), end: offset(14) },
  ];
}

const planner = typeof document === 'undefined' ? null : document.querySelector('[data-birthday-planner]');
if (planner) {
  const input = planner.querySelector('input');
  const status = planner.querySelector('[role="status"]');
  const dates = planner.querySelectorAll('[data-birthday-window]');
  const format = value => new Intl.DateTimeFormat('de-AT', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
  const reset = () => dates.forEach(cell => { cell.textContent = 'Noch kein Datum gewählt'; });
  input.addEventListener('input', () => {
    reset();
    status.textContent = 'Datum geändert. Bitte Einlösefenster neu berechnen.';
  });
  planner.querySelector('button').addEventListener('click', () => {
    const windows = birthdayWindows(input.value);
    if (!windows) {
      reset();
      status.textContent = 'Bitte einen gültigen Geburtstag im geplanten Besuchsjahr zwischen 1900 und 2099 auswählen.';
      input.focus();
      return;
    }
    windows.forEach((window, index) => {
      dates[index].textContent = window.start === window.end ? format(window.start) : `${format(window.start)} bis ${format(window.end)}`;
    });
    status.textContent = `Kalenderfenster für den Geburtstag am ${format(input.value)}. Bedingungen und Öffnungstage aus der Tabelle gelten zusätzlich.`;
  });
  planner.querySelector('[data-birthday-controls]').hidden = false;
  dates.forEach(cell => { cell.hidden = false; });
}
