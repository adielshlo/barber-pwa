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
  const confirmCloseBtn = document.getElementById('confirm-close-btn');

  const viewTabs = document.getElementById('view-tabs');
  const myAppointmentsView = document.getElementById('my-appointments-view');
  const phoneLookupCard = document.getElementById('phone-lookup-card');
  const myAppointmentsListCard = document.getElementById('my-appointments-list-card');
  const myAppointmentsPhoneInput = document.getElementById('my-appointments-phone-input');
  const myAppointmentsSearchBtn = document.getElementById('my-appointments-search-btn');
  const myAppointmentsError = document.getElementById('my-appointments-error');
  const myAppointmentsList = document.getElementById('my-appointments-list');
  const myAppointmentsEmpty = document.getElementById('my-appointments-empty');
  const changePhoneBtn = document.getElementById('change-phone-btn');

  const PHONE_STORAGE_KEY = 'barber_customer_phone';

  const phoneInput = document.getElementById('phone-input');
  const PHONE_RE = /^05\d{8}$/;
  const PHONE_ERROR = 'יש להזין מספר נייד תקין בן 10 ספרות (לדוגמה: 0501234567)';

  let selectedDate = null;
  let selectedSlot = null;
  let myAppointmentsPhone = null;

  // Digits-only, with a leading +972/972 international prefix collapsed
  // down to the local leading 0 (matches how the backend stores numbers).
  function sanitizePhone(raw) {
    return raw.replace(/\D/g, '').replace(/^972/, '0');
  }

  function getIsraelTodayISO() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
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

      localStorage.setItem(PHONE_STORAGE_KEY, phone);
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
    confirmDetails.appendChild(detailRow('שירות', 'תספורת'));
    confirmDetails.appendChild(detailRow('תאריך', DayPicker.formatDateFull(appointment.date)));
    confirmDetails.appendChild(detailRow('שעה', appointment.time_slot));
    confirmDetails.appendChild(detailRow('שם', appointment.customer_name));
    if (appointment.address) {
      confirmDetails.appendChild(detailRow('כתובת', appointment.address));
    }

    viewTabs.hidden = true;
    bookingView.hidden = true;
    myAppointmentsView.hidden = true;
    confirmationSection.hidden = false;
  }

  confirmCloseBtn.addEventListener('click', () => {
    confirmationSection.hidden = true;
    selectedSlot = null;
    switchView('booking');
    loadSlots();
  });

  // --- View tabs (booking / my appointments) ---
  function switchView(view) {
    viewTabs.hidden = false;
    viewTabs.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    bookingView.hidden = view !== 'booking';
    myAppointmentsView.hidden = view !== 'my-appointments';

    if (view === 'my-appointments') {
      initMyAppointmentsView();
    }
  }

  viewTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchView(btn.dataset.view);
  });

  // --- My appointments ---
  function showPhoneLookupForm() {
    phoneLookupCard.hidden = false;
    myAppointmentsListCard.hidden = true;
    myAppointmentsError.textContent = '';
    myAppointmentsPhoneInput.value = '';
  }

  function initMyAppointmentsView() {
    const storedPhone = localStorage.getItem(PHONE_STORAGE_KEY);
    if (storedPhone) {
      myAppointmentsPhone = storedPhone;
      loadMyAppointments(storedPhone);
    } else {
      showPhoneLookupForm();
    }
  }

  myAppointmentsPhoneInput.addEventListener('input', () => {
    myAppointmentsPhoneInput.value = sanitizePhone(myAppointmentsPhoneInput.value);
  });

  myAppointmentsSearchBtn.addEventListener('click', () => {
    const phone = sanitizePhone(myAppointmentsPhoneInput.value);
    if (!PHONE_RE.test(phone)) {
      myAppointmentsError.textContent = PHONE_ERROR;
      return;
    }
    myAppointmentsPhone = phone;
    loadMyAppointments(phone);
  });

  changePhoneBtn.addEventListener('click', () => {
    localStorage.removeItem(PHONE_STORAGE_KEY);
    myAppointmentsPhone = null;
    showPhoneLookupForm();
  });

  async function loadMyAppointments(phone) {
    myAppointmentsError.textContent = '';
    try {
      const res = await fetch(`/api/my-appointments?phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (!res.ok) {
        myAppointmentsError.textContent = data.error || 'שגיאה בטעינת התורים.';
        return;
      }
      localStorage.setItem(PHONE_STORAGE_KEY, phone);
      phoneLookupCard.hidden = true;
      myAppointmentsListCard.hidden = false;
      renderMyAppointments(data.appointments || []);
    } catch (err) {
      myAppointmentsError.textContent = 'שגיאת רשת. נסו שוב.';
    }
  }

  function renderMyAppointments(appointments) {
    myAppointmentsList.innerHTML = '';

    if (appointments.length === 0) {
      myAppointmentsEmpty.hidden = false;
      return;
    }
    myAppointmentsEmpty.hidden = true;

    const todayIsrael = getIsraelTodayISO();

    appointments.forEach((appt) => {
      const item = document.createElement('div');
      item.className = 'appt-item';

      const top = document.createElement('div');
      top.className = 'appt-top';
      const time = document.createElement('span');
      time.className = 'appt-time';
      time.textContent = appt.time_slot;
      const date = document.createElement('span');
      date.className = 'appt-date';
      date.textContent = DayPicker.formatDateFull(appt.date);
      top.appendChild(time);
      top.appendChild(date);
      item.appendChild(top);

      if (appt.date > todayIsrael) {
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn danger small';
        cancelBtn.textContent = 'בטל תור';
        cancelBtn.addEventListener('click', () => cancelAppointment(appt));
        actions.appendChild(cancelBtn);
        item.appendChild(actions);
      }

      myAppointmentsList.appendChild(item);
    });
  }

  async function cancelAppointment(appt) {
    const confirmed = window.confirm(`לבטל את התור ל${DayPicker.formatDateFull(appt.date)} בשעה ${appt.time_slot}?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/appointments/${appt.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: myAppointmentsPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error || 'ביטול התור נכשל.');
        return;
      }
      await loadMyAppointments(myAppointmentsPhone);
    } catch (err) {
      window.alert('שגיאת רשת. נסו שוב.');
    }
  }

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
