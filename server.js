require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { db, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const BARBER_PHONE = process.env.BARBER_PHONE || '972XXXXXXXXX';
const BIT_PAYMENT_URL = process.env.BIT_PAYMENT_URL || 'https://bmv.fyi/YOUR_BIT_LINK';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || 'barber_dispatch_secret_2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const PHONE_RE = /^05\d{8}$/;

// --- Simple in-memory admin session tokens ---
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Authorizes either an existing admin session (x-admin-token header) or the
// static automation secret, accepted via Bearer header or ?token= query
// param so mobile automations (Apple Shortcuts, Tasker, etc.) can call it.
function requireAdminOrApiToken(req, res, next) {
  const sessionToken = req.get('x-admin-token');
  if (sessionToken && adminTokens.has(sessionToken)) {
    return next();
  }

  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;

  if ((bearerToken && bearerToken === ADMIN_API_TOKEN) || (queryToken && queryToken === ADMIN_API_TOKEN)) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

// Normalizes any phone input (dashes/spaces, with or without a +972/972
// international prefix) down to the digits-only local form ('05XXXXXXXX')
// that appointments.phone is stored as.
function sanitizePhone(rawPhone) {
  return String(rawPhone || '').replace(/\D/g, '').replace(/^972/, '0');
}

// Converts a local Israeli number ('050-1234567', '0501234567') or an
// already-international one ('972501234567') into the digits-only
// international form wa.me expects.
function toWhatsappPhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

function buildDispatchMessage(customerName, time) {
  return `בוקר טוב ${customerName}! ✂️

מזכיר לך על התור שקבעת להיום אצל אחיה הספר בשעה ${time}.

💳 לתשלום מהיר ב-Bit:
${BIT_PAYMENT_URL}

אם חל שינוי או ביטול, אנא השב להודעה זו בהקדם. נתראה!`;
}

// Returns today's date as YYYY-MM-DD in the Israel timezone, independent of
// the server host's local timezone.
function getIsraelTodayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// GET /api/config
// Public, non-sensitive config the frontend needs for click-to-chat / payment links.
app.get('/api/config', (req, res) => {
  res.json({ barberPhone: toWhatsappPhone(BARBER_PHONE), bitPaymentUrl: BIT_PAYMENT_URL });
});

// GET /api/slots?date=YYYY-MM-DD
// Returns open slots for the date that don't already have an active appointment.
app.get('/api/slots', async (req, res) => {
  const { date } = req.query;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Query param "date" is required in YYYY-MM-DD format' });
  }

  try {
    const result = await db.execute({
      sql: `SELECT o.time_slot FROM open_slots o
            WHERE o.date = ?
              AND NOT EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.date = o.date AND a.time_slot = o.time_slot AND a.status != 'cancelled'
              )
            ORDER BY o.time_slot`,
      args: [date],
    });
    const available = result.rows.map((row) => row.time_slot);
    res.json({ date, available });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bookings
app.post('/api/bookings', async (req, res) => {
  const { customer_name, phone, address, date, time_slot } = req.body || {};

  if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
    return res.status(400).json({ error: 'customer_name is required' });
  }
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone is required' });
  }
  const sanitizedPhone = sanitizePhone(phone);
  if (!PHONE_RE.test(sanitizedPhone)) {
    return res.status(400).json({ error: 'יש להזין מספר נייד תקין בן 10 ספרות (לדוגמה: 0501234567)' });
  }
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
  }
  if (!time_slot || !TIME_RE.test(time_slot)) {
    return res.status(400).json({ error: 'time_slot is required in HH:MM format' });
  }

  try {
    const openResult = await db.execute({
      sql: `SELECT 1 FROM open_slots WHERE date = ? AND time_slot = ?`,
      args: [date, time_slot],
    });
    if (openResult.rows.length === 0) {
      return res.status(409).json({ error: 'This slot is not available' });
    }

    const insertResult = await db.execute({
      sql: `INSERT INTO appointments (customer_name, phone, address, date, time_slot, status)
            VALUES (?, ?, ?, ?, ?, 'confirmed')`,
      args: [customer_name.trim(), sanitizedPhone, address ? String(address).trim() : null, date, time_slot],
    });

    const appointmentResult = await db.execute({
      sql: `SELECT * FROM appointments WHERE id = ?`,
      args: [insertResult.lastInsertRowid],
    });

    res.status(201).json(appointmentResult.rows[0]);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT' || /UNIQUE constraint failed/.test(err.message || '')) {
      return res.status(409).json({ error: 'This slot has already been booked' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/my-appointments?phone=...
// Returns the customer's own upcoming (today or later) active appointments,
// sorted soonest first.
app.get('/api/my-appointments', async (req, res) => {
  const { phone } = req.query;
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Query param "phone" is required' });
  }
  const sanitizedPhone = sanitizePhone(phone);
  if (!PHONE_RE.test(sanitizedPhone)) {
    return res.status(400).json({ error: 'יש להזין מספר נייד תקין בן 10 ספרות (לדוגמה: 0501234567)' });
  }

  try {
    const today = getIsraelTodayISO();
    const result = await db.execute({
      sql: `SELECT * FROM appointments
            WHERE phone = ? AND status != 'cancelled' AND date >= ?
            ORDER BY date ASC, time_slot ASC`,
      args: [sanitizedPhone, today],
    });
    res.json({ appointments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/appointments/:id/cancel
// Body: { phone }. Only the customer who booked the appointment (matched by
// normalized phone) can cancel it, and not on the day of the appointment
// itself (or after).
app.post('/api/appointments/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const { phone } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'phone is required' });
  }
  const sanitizedPhone = sanitizePhone(phone);

  try {
    const result = await db.execute({ sql: `SELECT * FROM appointments WHERE id = ?`, args: [id] });
    const appointment = result.rows[0];

    if (!appointment || appointment.status === 'cancelled') {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    if (appointment.phone !== sanitizedPhone) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const todayIsrael = getIsraelTodayISO();
    if (appointment.date <= todayIsrael) {
      return res.status(400).json({ error: 'לא ניתן לבטל תור ביום התור עצמו. לביטול דחוף פנה ישירות לספר' });
    }

    await db.execute({ sql: `UPDATE appointments SET status = 'cancelled' WHERE id = ?`, args: [id] });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body || {};
  if (!pin || String(pin) !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

// POST /api/admin/slots
// Body: { date, time_slot } for a single slot, or { date, time_slots: [...] } for a batch.
app.post('/api/admin/slots', requireAdmin, async (req, res) => {
  const { date, time_slot, time_slots } = req.body || {};

  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
  }

  const slots = Array.isArray(time_slots) ? time_slots : time_slot ? [time_slot] : [];
  if (slots.length === 0) {
    return res.status(400).json({ error: 'time_slot or time_slots is required' });
  }
  for (const s of slots) {
    if (!TIME_RE.test(s)) {
      return res.status(400).json({ error: `Invalid time_slot: ${s}` });
    }
  }

  try {
    await db.batch(
      slots.map((s) => ({
        sql: `INSERT OR IGNORE INTO open_slots (date, time_slot) VALUES (?, ?)`,
        args: [date, s],
      })),
      'write'
    );

    const result = await db.execute({
      sql: `SELECT time_slot FROM open_slots WHERE date = ? ORDER BY time_slot`,
      args: [date],
    });
    const open_slots = result.rows.map((row) => row.time_slot);

    res.status(201).json({ date, open_slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/slots
// Body: { date, time_slot }. Rejects if the slot has an active appointment.
app.delete('/api/admin/slots', requireAdmin, async (req, res) => {
  const { date, time_slot } = req.body || {};

  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'date is required in YYYY-MM-DD format' });
  }
  if (!time_slot || !TIME_RE.test(time_slot)) {
    return res.status(400).json({ error: 'time_slot is required in HH:MM format' });
  }

  try {
    const bookedResult = await db.execute({
      sql: `SELECT 1 FROM appointments WHERE date = ? AND time_slot = ? AND status != 'cancelled'`,
      args: [date, time_slot],
    });
    if (bookedResult.rows.length > 0) {
      return res.status(409).json({ error: 'This slot is booked and cannot be removed' });
    }

    const result = await db.execute({
      sql: `DELETE FROM open_slots WHERE date = ? AND time_slot = ?`,
      args: [date, time_slot],
    });
    if (Number(result.rowsAffected) === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }

    res.json({ date, time_slot, removed: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/day-overview?date=YYYY-MM-DD
// Returns open slots alongside booked customer details for that date.
app.get('/api/admin/day-overview', requireAdmin, async (req, res) => {
  const { date } = req.query;
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Query param "date" is required in YYYY-MM-DD format' });
  }

  try {
    const [openSlotsResult, appointmentsResult] = await Promise.all([
      db.execute({ sql: `SELECT time_slot FROM open_slots WHERE date = ? ORDER BY time_slot`, args: [date] }),
      db.execute({
        sql: `SELECT * FROM appointments WHERE date = ? AND status != 'cancelled' ORDER BY time_slot`,
        args: [date],
      }),
    ]);

    const openSlots = openSlotsResult.rows.map((row) => row.time_slot);
    const appointments = appointmentsResult.rows;
    const bookedByTime = new Map(appointments.map((a) => [a.time_slot, a]));

    const times = Array.from(new Set([...openSlots, ...bookedByTime.keys()])).sort();
    const slots = times.map((time_slot) => {
      const appointment = bookedByTime.get(time_slot) || null;
      return { time_slot, status: appointment ? 'booked' : 'open', appointment };
    });

    res.json({ date, slots, appointments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/config
// Admin-only: exposes the ready-to-use dispatch API URL (with the static
// automation token baked in) for the "connect your phone automation" helper card.
app.get('/api/admin/config', requireAdmin, (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ dispatchApiUrl: `${base}/api/admin/today-dispatch?token=${ADMIN_API_TOKEN}` });
});

// GET /api/admin/today-dispatch
// Returns today's (Israel timezone) active appointments as ready-to-send
// WhatsApp click-to-chat links, for the admin morning dispatch center and
// for external mobile automations (Apple Shortcuts, etc.) via ADMIN_API_TOKEN.
app.get('/api/admin/today-dispatch', requireAdminOrApiToken, async (req, res) => {
  const date = getIsraelTodayISO();

  let appointments;
  try {
    const result = await db.execute({
      sql: `SELECT * FROM appointments WHERE date = ? AND status != 'cancelled' ORDER BY time_slot`,
      args: [date],
    });
    appointments = result.rows;
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const dispatch = appointments.map((a) => {
    const cleanPhone = toWhatsappPhone(a.phone);
    const message = buildDispatchMessage(a.customer_name, a.time_slot);
    return {
      id: a.id,
      customerName: a.customer_name,
      rawPhone: a.phone,
      cleanPhone,
      time: a.time_slot,
      message,
      whatsappUrl: `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`,
    };
  });

  res.json({ count: dispatch.length, date, appointments: dispatch });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Barber PWA backend listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
