(() => {
  function initSplash() {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;

    if (sessionStorage.getItem('splashShown')) {
      splash.remove();
      return;
    }
    sessionStorage.setItem('splashShown', 'true');

    const REVEAL_MS = 2800;
    const HOLD_MS = 800;
    const EXIT_MS = 1200;

    requestAnimationFrame(() => splash.classList.add('reveal'));

    setTimeout(() => {
      splash.classList.add('glitch-exit');
      setTimeout(() => splash.remove(), EXIT_MS);
    }, REVEAL_MS + HOLD_MS);
  }
  initSplash();

  const dayPicker = document.getElementById('day-picker');
  const bookingView = document.getElementById('booking-view');
  const slotsSection = document.getElementById('slots-section');
  const slotsGrid = document.getElementById('slots-grid');
  const slotsEmpty = document.getElementById('slots-empty');

  const bookingOverlay = document.getElementById('booking-overlay');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const bookingSummary = document.getElementById('booking-summary');
  const bookingForm = document.getElementById('booking-form');
  const submitBtn = document.getElementById('submit-btn');
  const formError = document.getElementById('form-error');

  const confirmationSection = document.getElementById('confirmation-section');
  const confirmDetails = document.getElementById('confirm-details');
  const confirmActions = document.getElementById('confirm-actions');
  const bitPaymentBtn = document.getElementById('bit-payment-btn');
  const whatsappReminderBtn = document.getElementById('whatsapp-reminder-btn');
  const confirmCloseBtn = document.getElementById('confirm-close-btn');

  let appConfig = { barberPhone: '', bitPaymentUrl: '' };
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) appConfig = await res.json();
    } catch (err) {
      // Confirmation action buttons are non-critical; booking still works without them.
    }
  }
  loadConfig();

  const phoneInput = document.getElementById('phone-input');
  const PHONE_RE = /^05\d{8}$/;
  const PHONE_ERROR = 'יש להזין מספר נייד תקין בן 10 ספרות (לדוגמה: 0501234567)';

  let selectedDate = null;
  let selectedSlot = null;

  function sanitizePhone(raw) {
    return raw.replace(/\D/g, '').replace(/^972/, '0');
  }

  // Normalize as the user types or pastes (strips dashes/spaces, collapses
  // a +972/972 international prefix down to the local leading 0).
  phoneInput.addEventListener('input', () => {
    const cursor = phoneInput.selectionStart ?? phoneInput.value.length;
    const digitsBeforeCursor = phoneInput.value.slice(0, cursor).replace(/\D/g, '').length;
    const normalized = sanitizePhone(phoneInput.value);
    phoneInput.value = normalized;
    const pos = Math.min(digitsBeforeCursor, normalized.length);
    phoneInput.setSelectionRange(pos, pos);
  });

  async function loadSlots() {
    slotsSection.hidden = false;
    slotsGrid.innerHTML = '';
    slotsEmpty.hidden = true;

    if (!selectedDate) {
      slotsSection.hidden = true;
      return;
    }

    try {
      const res = await fetch(`/api/slots?date=${encodeURIComponent(selectedDate)}`);
      if (!res.ok) throw new Error('Failed to load slots');
      const data = await res.json();
      renderSlots(data.available || []);
    } catch (err) {
      slotsGrid.innerHTML = '';
      slotsEmpty.hidden = false;
      slotsEmpty.textContent = 'שגיאה בטעינת השעות הפנויות. נסו שוב.';
    }
  }

  function renderSlots(available) {
    slotsGrid.innerHTML = '';
    if (available.length === 0) {
      slotsEmpty.hidden = false;
      slotsEmpty.textContent = 'אין שעות פנויות בתאריך זה.';
      return;
    }
    slotsEmpty.hidden = true;

    available.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = slot;
      btn.dataset.slot = slot;
      slotsGrid.appendChild(btn);
    });
  }

  // Event delegation: the grid is re-rendered often, so a single listener on
  // the (stable) container is more robust than re-binding one per button.
  slotsGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.slot-btn');
    if (!btn || btn.disabled) return;
    openBookingModal(btn.dataset.slot);
  });

  function openBookingModal(slot) {
    selectedSlot = slot;
    formError.textContent = '';
    bookingForm.reset();
    bookingSummary.textContent = `${DayPicker.formatDateFull(selectedDate)} בשעה ${slot}`;
    bookingOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeBookingModal() {
    bookingOverlay.hidden = true;
    selectedSlot = null;
    document.body.style.overflow = 'auto';
  }

  modalCloseBtn.addEventListener('click', closeBookingModal);

  // Close on backdrop click (but not when the click originated inside the modal card).
  bookingOverlay.addEventListener('click', (e) => {
    if (e.target === bookingOverlay) closeBookingModal();
  });

  // Close on Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !bookingOverlay.hidden) closeBookingModal();
  });

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';

    if (!selectedDate || !selectedSlot) {
      formError.textContent = 'בחרו תאריך ושעה.';
      return;
    }

    const customer_name = document.getElementById('name-input').value.trim();
    const phone = sanitizePhone(phoneInput.value);
    const address = document.getElementById('address-input').value.trim();

    if (!customer_name) {
      formError.textContent = 'יש להזין שם מלא.';
      return;
    }
    if (!PHONE_RE.test(phone)) {
      formError.textContent = PHONE_ERROR;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> קובע תור…';

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name, phone, address, date: selectedDate, time_slot: selectedSlot }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          formError.textContent = 'השעה הזו נתפסה זה עתה. בחרו שעה אחרת.';
          closeBookingModal();
          await loadSlots();
        } else {
          formError.textContent = data.error || 'משהו השתבש. נסו שוב.';
        }
        return;
      }

      closeBookingModal();
      bookingForm.reset();
      showConfirmation(data);
    } catch (err) {
      formError.textContent = 'שגיאת רשת. נסו שוב.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'אישור תור';
    }
  });

  function detailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function showConfirmation(appointment) {
    confirmDetails.innerHTML = '';
    confirmDetails.appendChild(detailRow('שם', appointment.customer_name));
    confirmDetails.appendChild(detailRow('תאריך', DayPicker.formatDateFull(appointment.date)));
    confirmDetails.appendChild(detailRow('שעה', appointment.time_slot));
    if (appointment.address) {
      confirmDetails.appendChild(detailRow('כתובת', appointment.address));
    }

    if (appConfig.bitPaymentUrl) {
      bitPaymentBtn.href = appConfig.bitPaymentUrl;
    }
    if (appConfig.barberPhone) {
      const summary = `היי! קבעתי תור ל${DayPicker.formatDateFull(appointment.date)} בשעה ${appointment.time_slot}. השם שלי: ${appointment.customer_name}.`;
      whatsappReminderBtn.href = `https://wa.me/${appConfig.barberPhone}?text=${encodeURIComponent(summary)}`;
    }
    confirmActions.hidden = !appConfig.bitPaymentUrl && !appConfig.barberPhone;

    bookingView.hidden = true;
    confirmationSection.hidden = false;
  }

  confirmCloseBtn.addEventListener('click', () => {
    confirmationSection.hidden = true;
    bookingView.hidden = false;
    selectedSlot = null;
    loadSlots();
  });

  DayPicker.render(dayPicker, (dateStr) => {
    selectedDate = dateStr;
    loadSlots();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
