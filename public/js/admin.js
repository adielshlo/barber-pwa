(() => {
  const HOURS = [];
  for (let h = 9; h <= 18; h++) HOURS.push(`${String(h).padStart(2, '0')}:00`);

  const loginOverlay = document.getElementById('login-overlay');
  const loginForm = document.getElementById('login-form');
  const pinInput = document.getElementById('pin-input');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  const adminApp = document.getElementById('admin-app');
  const logoutBtn = document.getElementById('logout-btn');

  const dayPicker = document.getElementById('day-picker');
  const openAllBtn = document.getElementById('open-all-btn');
  const manageError = document.getElementById('manage-error');
  const hoursGrid = document.getElementById('hours-grid');

  const appointmentsList = document.getElementById('appointments-list');
  const appointmentsEmpty = document.getElementById('appointments-empty');

  const dispatchList = document.getElementById('dispatch-list');
  const dispatchEmpty = document.getElementById('dispatch-empty');
  const dispatchApiUrl = document.getElementById('dispatch-api-url');
  const copyApiUrlBtn = document.getElementById('copy-api-url-btn');

  let token = sessionStorage.getItem('adminToken') || null;
  let dayOverview = null;
  let selectedDate = null;

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-admin-token': token,
      },
    });
    if (res.status === 401) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    return res;
  }

  async function showApp() {
    loginOverlay.hidden = true;
    adminApp.hidden = false;
    DayPicker.render(dayPicker, (dateStr) => {
      selectedDate = dateStr;
      loadDayOverview();
    });
    loadDispatch();
    loadAdminConfig();
  }

  function showLogin() {
    loginOverlay.hidden = false;
    adminApp.hidden = true;
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'בודק…';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput.value }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || 'קוד שגוי';
        return;
      }
      token = data.token;
      sessionStorage.setItem('adminToken', token);
      pinInput.value = '';
      showApp();
    } catch (err) {
      loginError.textContent = 'שגיאת רשת. נסו שוב.';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'כניסה';
    }
  });

  function handleLogout() {
    token = null;
    sessionStorage.removeItem('adminToken');
    showLogin();
  }

  logoutBtn.addEventListener('click', handleLogout);

  async function loadDayOverview() {
    const date = selectedDate;
    if (!date) return;
    manageError.textContent = '';
    try {
      const res = await apiFetch(`/api/admin/day-overview?date=${encodeURIComponent(date)}`);
      if (!res.ok) throw new Error('failed');
      dayOverview = await res.json();
      renderHoursGrid();
      renderAppointments();
    } catch (err) {
      if (err.message !== 'Unauthorized') manageError.textContent = 'שגיאה בטעינת הנתונים.';
    }
  }

  function renderHoursGrid() {
    hoursGrid.innerHTML = '';
    const statusByHour = new Map((dayOverview.slots || []).map((s) => [s.time_slot, s.status]));

    HOURS.forEach((hour) => {
      const status = statusByHour.get(hour) || 'closed';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `slot-btn hour-btn ${status}`;
      btn.textContent = hour;

      if (status === 'booked') {
        btn.disabled = true;
        btn.title = 'תפוס';
      } else {
        btn.title = status === 'open' ? 'לחיצה תסגור את השעה' : 'לחיצה תפתח את השעה';
        btn.addEventListener('click', () => toggleHour(hour, status));
      }

      hoursGrid.appendChild(btn);
    });
  }

  async function toggleHour(hour, status) {
    const date = selectedDate;
    manageError.textContent = '';

    try {
      const res =
        status === 'open'
          ? await apiFetch('/api/admin/slots', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date, time_slot: hour }),
            })
          : await apiFetch('/api/admin/slots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ date, time_slot: hour }),
            });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        manageError.textContent = data.error || 'הפעולה נכשלה.';
      }
      await loadDayOverview();
    } catch (err) {
      if (err.message !== 'Unauthorized') manageError.textContent = 'שגיאת רשת.';
    }
  }

  openAllBtn.addEventListener('click', async () => {
    const date = selectedDate;
    manageError.textContent = '';
    openAllBtn.disabled = true;

    try {
      const res = await apiFetch('/api/admin/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time_slots: HOURS }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        manageError.textContent = data.error || 'שגיאה בפתיחת השעות.';
      }
      await loadDayOverview();
    } catch (err) {
      if (err.message !== 'Unauthorized') manageError.textContent = 'שגיאת רשת.';
    } finally {
      openAllBtn.disabled = false;
    }
  });

  function renderAppointments() {
    appointmentsList.innerHTML = '';
    const appts = dayOverview.appointments || [];

    if (appts.length === 0) {
      appointmentsEmpty.hidden = false;
      return;
    }
    appointmentsEmpty.hidden = true;

    appts.forEach((appt) => {
      const item = document.createElement('div');
      item.className = 'appt-item';

      const top = document.createElement('div');
      top.className = 'appt-top';
      const time = document.createElement('span');
      time.className = 'appt-time';
      time.textContent = appt.time_slot;
      const name = document.createElement('span');
      name.className = 'appt-name';
      name.textContent = appt.customer_name;
      top.appendChild(time);
      top.appendChild(name);

      const sub = document.createElement('div');
      sub.className = 'appt-sub';
      sub.textContent = appt.address ? `${appt.phone} · ${appt.address}` : appt.phone;

      item.appendChild(top);
      item.appendChild(sub);
      appointmentsList.appendChild(item);
    });
  }

  async function loadDispatch() {
    try {
      const res = await apiFetch('/api/admin/today-dispatch');
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      renderDispatch(data.appointments || []);
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        dispatchList.innerHTML = '';
        dispatchEmpty.hidden = false;
        dispatchEmpty.textContent = 'שגיאה בטעינת תזכורות הבוקר.';
      }
    }
  }

  function renderDispatch(appointments) {
    dispatchList.innerHTML = '';

    if (appointments.length === 0) {
      dispatchEmpty.hidden = false;
      dispatchEmpty.textContent = 'אין תורים שנקבעו להיום 🎉';
      return;
    }
    dispatchEmpty.hidden = true;

    appointments.forEach((appt) => {
      const item = document.createElement('div');
      item.className = 'dispatch-item';

      const info = document.createElement('div');
      info.className = 'dispatch-info';
      const name = document.createElement('span');
      name.className = 'dispatch-name';
      name.textContent = appt.customerName;
      const time = document.createElement('span');
      time.className = 'dispatch-time';
      time.textContent = appt.time;
      info.appendChild(time);
      info.appendChild(name);

      const sendBtn = document.createElement('a');
      sendBtn.className = 'btn whatsapp-btn small';
      sendBtn.href = appt.whatsappUrl;
      sendBtn.target = '_blank';
      sendBtn.rel = 'noopener';
      sendBtn.textContent = '📱 שלח תזכורת + ביט';

      item.appendChild(info);
      item.appendChild(sendBtn);
      dispatchList.appendChild(item);
    });
  }

  async function loadAdminConfig() {
    try {
      const res = await apiFetch('/api/admin/config');
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      dispatchApiUrl.textContent = data.dispatchApiUrl || '';
    } catch (err) {
      // Helper card is non-critical; fail silently.
    }
  }

  copyApiUrlBtn.addEventListener('click', async () => {
    const url = dispatchApiUrl.textContent;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      const original = copyApiUrlBtn.textContent;
      copyApiUrlBtn.textContent = '✓ הועתק';
      setTimeout(() => {
        copyApiUrlBtn.textContent = original;
      }, 1500);
    } catch (err) {
      // Clipboard API unavailable; nothing more we can do here.
    }
  });

  if (token) {
    showApp();
  } else {
    showLogin();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
