// Shared 7-day horizontal rolling picker, used identically by the customer
// and admin pages so date math and labeling never drift between them.
window.DayPicker = (() => {
  const DAY_NAMES = ["יום א'", "יום ב'", "יום ג'", "יום ד'", "יום ה'", "יום ו'", 'שבת'];

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function formatShortDate(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  }

  function dayLabel(d, index) {
    if (index === 0) return 'היום';
    if (index === 1) return 'מחר';
    return DAY_NAMES[d.getDay()];
  }

  function formatDateFull(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return `${DAY_NAMES[date.getDay()]}, ${formatShortDate(date)}`;
  }

  function next7Days() {
    const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    return Array.from({ length: 7 }, (_, i) => addDays(today, i));
  }

  function selectPill(container, dateStr, onSelect) {
    container.querySelectorAll('.day-pill').forEach((b) => {
      b.classList.toggle('selected', b.dataset.date === dateStr);
    });
    onSelect(dateStr);
  }

  // Renders the 7-day pill bar into `container`, wires a single delegated
  // click handler, and auto-selects today (invoking onSelect immediately).
  function render(container, onSelect) {
    container.innerHTML = '';

    next7Days().forEach((d, index) => {
      const dateStr = toDateStr(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-pill';
      btn.dataset.date = dateStr;

      const name = document.createElement('span');
      name.className = 'day-name';
      name.textContent = dayLabel(d, index);

      const dateEl = document.createElement('span');
      dateEl.className = 'day-date';
      dateEl.textContent = formatShortDate(d);

      btn.appendChild(name);
      btn.appendChild(dateEl);
      container.appendChild(btn);
    });

    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.day-pill');
      if (!btn || !container.contains(btn)) return;
      selectPill(container, btn.dataset.date, onSelect);
    });

    const firstPill = container.querySelector('.day-pill');
    if (firstPill) selectPill(container, firstPill.dataset.date, onSelect);
  }

  return { DAY_NAMES, toDateStr, formatShortDate, formatDateFull, next7Days, render };
})();
