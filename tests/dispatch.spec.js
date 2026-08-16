const { test, expect } = require('playwright/test');

const ADMIN_API_TOKEN = 'barber_dispatch_secret_2026';
const ADMIN_PIN = '1234';

test.describe('a) GET /api/admin/today-dispatch', () => {
  test('returns sanitized phone and formatted WhatsApp text with a valid token', async ({ request }) => {
    const res = await request.get(`/api/admin/today-dispatch?token=${ADMIN_API_TOKEN}`);
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data.count).toBe(data.appointments.length);
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const appt = data.appointments.find((a) => a.rawPhone === '0501234567');
    expect(appt).toBeTruthy();
    expect(appt.cleanPhone).toBe('972501234567');
    expect(appt.message).toContain('בוקר טוב ישראל ישראלי');
    expect(appt.message).toContain('💳 לתשלום מהיר ב-Bit');
    expect(appt.message).toContain('https://bmv.fyi/YOUR_BIT_LINK');
    expect(appt.whatsappUrl).toBe(`https://wa.me/${appt.cleanPhone}?text=${encodeURIComponent(appt.message)}`);
  });

  test('rejects requests with no token and with a wrong token', async ({ request }) => {
    const noToken = await request.get('/api/admin/today-dispatch');
    expect(noToken.status()).toBe(401);

    const wrongToken = await request.get('/api/admin/today-dispatch?token=wrong');
    expect(wrongToken.status()).toBe(401);
  });

  test('accepts the token via Authorization: Bearer header', async ({ request }) => {
    const res = await request.get('/api/admin/today-dispatch', {
      headers: { Authorization: `Bearer ${ADMIN_API_TOKEN}` },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe('b) Customer confirmation action buttons', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows Bit payment + WhatsApp reminder buttons after booking', async ({ page }) => {
    await page.goto('/');

    const slotBtn = page.locator('.slot-btn:not(:disabled)').first();
    await slotBtn.waitFor({ state: 'visible', timeout: 15000 });
    await slotBtn.click();

    await page.fill('#name-input', 'בדיקת פלייווייט');
    await page.fill('#phone-input', '0521234567');
    await page.click('#submit-btn');

    await expect(page.locator('#confirmation-section')).toBeVisible({ timeout: 15000 });

    const bitBtn = page.locator('#bit-payment-btn');
    const waBtn = page.locator('#whatsapp-reminder-btn');
    await expect(bitBtn).toBeVisible();
    await expect(waBtn).toBeVisible();

    await expect(bitBtn).toHaveAttribute('href', 'https://bmv.fyi/YOUR_BIT_LINK');
    await expect(waBtn).toHaveAttribute('href', /^https:\/\/wa\.me\/972/);
    await expect(bitBtn).toHaveAttribute('target', '_blank');
    await expect(waBtn).toHaveAttribute('target', '_blank');
  });
});

test.describe('c) Admin Morning Dispatch center', () => {
  test('renders today\'s appointments with a click-to-chat button', async ({ page }) => {
    await page.goto('/admin.html');
    await page.fill('#pin-input', ADMIN_PIN);
    await page.click('#login-btn');

    await expect(page.locator('#admin-app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#dispatch-card')).toContainText('תזכורות בוקר להיום');

    const items = page.locator('.dispatch-item');
    await expect(items.first()).toBeVisible({ timeout: 10000 });
    await expect(items.first().locator('.whatsapp-btn')).toContainText('שלח תזכורת');

    await expect(page.locator('#automation-card')).toContainText('חיבור לאוטומציה');
    await page.locator('#automation-card').locator('summary').click();
    await expect(page.locator('#dispatch-api-url')).toContainText('/api/admin/today-dispatch?token=');
  });

  test('renders the empty state when there are no appointments today', async ({ page }) => {
    await page.route('**/api/admin/today-dispatch*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 0, date: '2099-01-01', appointments: [] }),
      })
    );

    await page.goto('/admin.html');
    await page.fill('#pin-input', ADMIN_PIN);
    await page.click('#login-btn');

    await expect(page.locator('#admin-app')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#dispatch-empty')).toBeVisible();
    await expect(page.locator('#dispatch-empty')).toContainText('אין תורים שנקבעו להיום');
    await expect(page.locator('.dispatch-item')).toHaveCount(0);
  });
});
