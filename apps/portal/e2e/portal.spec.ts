import { expect, test } from '@playwright/test';
import { CONV, mockPortal } from './fixtures.ts';

const agent = { name: 'Agent One', roles: ['agent'] };
const admin = { name: 'Admin', roles: ['admin'] };

test('asks to sign in with Microsoft when there is no session', async ({ page }) => {
  await mockPortal(page, 401);
  await page.goto('/portal/');
  await expect(page.getByRole('link', { name: 'Inloggen met Microsoft' })).toHaveAttribute(
    'href',
    '/portal/auth/login',
  );
});

test('says when the account has no portal role', async ({ page }) => {
  await mockPortal(page, 403);
  await page.goto('/portal/');
  await expect(page.getByText('Je account heeft geen toegang tot deze pagina.')).toBeVisible();
});

test('lists flagged conversations and opens one with personal data masked', async ({ page }) => {
  const api = await mockPortal(page, agent);
  await page.goto('/portal/');
  await expect(page.getByRole('heading', { name: 'Gemarkeerde gesprekken' })).toBeVisible();
  const row = page.getByRole('row', { name: /Geen antwoord gevonden/ });
  await expect(row).toContainText('Duim omlaag');
  await row.getByRole('link', { name: 'Openen' }).click();
  await expect(page.getByText('Mail me op [•••]')).toBeVisible();
  await expect(page.getByText('Persoonsgegevens zijn verborgen.')).toBeVisible();
  await expect(page.getByText('Beoordeeld als niet nuttig')).toBeVisible();
  await expect(page.getByText('Ticket aangemaakt (Payments)')).toBeVisible();
  expect(api.requests.some((r) => r.path.endsWith('/reveal'))).toBe(false);
});

test('shows the original text only on request, with the audit note', async ({ page }) => {
  const api = await mockPortal(page, agent);
  await page.goto(`/portal/#/conversations/${CONV}`);
  await expect(
    page.getByText('Het tonen van de originele tekst wordt vastgelegd in het auditlog.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Originele tekst tonen' }).click();
  await expect(page.getByText('Mail me op sam@example.com')).toBeVisible();
  await expect(page.getByText('Originele tekst (vastgelegd in het auditlog).')).toBeVisible();
  expect(api.requests.filter((r) => r.path.endsWith('/reveal')).map((r) => r.method)).toEqual([
    'POST',
  ]);
});

test('agents see the capabilities but cannot switch them', async ({ page }) => {
  await mockPortal(page, agent);
  await page.goto('/portal/#/capabilities');
  await expect(page.getByRole('heading', { name: 'Recente bezoeken' })).toBeVisible();
  await expect(page.getByText('Hoe vaak heb ik deze maand getraind?')).toBeVisible();
  await expect(page.getByText('Alleen beheerders kunnen dit wijzigen.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Uitschakelen/ })).toHaveCount(0);
});

test('admins switch a capability off', async ({ page }) => {
  const api = await mockPortal(page, admin);
  await page.goto('/portal/#/capabilities');
  const card = page.getByRole('region', { name: 'Recente bezoeken' });
  await card.getByRole('button', { name: 'Uitschakelen' }).click();
  await expect(card.getByText('Uit', { exact: true })).toBeVisible();
  expect(api.requests.find((r) => r.method === 'PUT')).toMatchObject({
    path: '/portal/api/capabilities/get_recent_visits',
    body: { enabled: false },
  });
});

test('shows the known limitations', async ({ page }) => {
  await mockPortal(page, agent);
  await page.goto('/portal/#/limitations');
  await expect(page.getByText('Zonder inloggen toont hij nooit accountgegevens.')).toBeVisible();
});

test('switches to English', async ({ page }) => {
  await mockPortal(page, agent);
  await page.goto('/portal/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Flagged conversations' })).toBeVisible();
  await expect(page.getByRole('row', { name: /No answer found/ })).toContainText('Thumbs down');
});

test('signs out', async ({ page }) => {
  const api = await mockPortal(page, agent);
  await page.goto('/portal/');
  await page.getByRole('button', { name: 'Uitloggen' }).click();
  await expect(page.getByRole('link', { name: 'Inloggen met Microsoft' })).toBeVisible();
  expect(api.requests.some((r) => r.path === '/portal/auth/logout' && r.method === 'POST')).toBe(
    true,
  );
});

test('explains a failed sign-in and offers to try again', async ({ page }) => {
  await mockPortal(page, 401);
  await page.goto('/portal/?signin_error=invalid');
  await expect(page.getByRole('alert')).toHaveText(
    'Inloggen is niet gelukt (mogelijk verlopen of afgebroken). Probeer het opnieuw.',
  );
  await expect(page.getByRole('link', { name: 'Inloggen met Microsoft' })).toBeVisible();
});

test('explains a missing portal role', async ({ page }) => {
  await mockPortal(page, 401);
  await page.goto('/portal/?signin_error=no_role');
  await expect(page.getByRole('alert')).toContainText('geen rol voor dit portaal');
});
