import { expect, type Page, test } from '@playwright/test';
import { mockApi } from './fixtures.ts';

const needsLogin = {
  text: 'Om vragen over je account te beantwoorden, log je eerst in met je e-mailadres.',
  lang: 'nl' as const,
  citations: [],
  action: 'login' as const,
};

async function openLogin(page: Page) {
  await page.goto('/?lang=nl');
  await page.getByRole('button', { name: 'Begrepen, start de chat' }).click();
  await page.getByRole('textbox').fill('Wanneer eindigt mijn contract?');
  await page.getByRole('button', { name: 'Versturen' }).click();
  await page.getByRole('button', { name: 'Inloggen' }).click();
  const form = page.getByRole('form', { name: 'Inloggen' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('member@example.com');
  await form.getByRole('button', { name: 'Code versturen' }).click();
  await expect(form.getByText('We hebben een code naar je e-mailadres gestuurd.')).toBeVisible();
  return form;
}

test('logs in with the emailed code (one membership)', async ({ page }) => {
  const api = await mockApi(page, [needsLogin]);
  const form = await openLogin(page);
  await form.getByLabel('Code', { exact: true }).fill('123456');
  await form.getByRole('button', { name: 'Inloggen' }).click();
  await expect(page.getByText('Je bent ingelogd (TrainMore Amsterdam).')).toBeVisible();
  const verify = api.requests.find((r) => r.path.endsWith('/login/verify'));
  expect(verify?.body).toEqual({ email: 'member@example.com', code: '123456' });
  expect(api.requests.find((r) => r.path.endsWith('/login/request'))?.body).toMatchObject({
    email: 'member@example.com',
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  });
});

test('asks which membership when there are several', async ({ page }) => {
  const api = await mockApi(page, [needsLogin], 201, [
    { index: 0, studioName: 'TrainMore Amsterdam', status: 'MEMBER', maskedNumber: '•••004' },
    { index: 1, studioName: 'TrainMore Utrecht', status: 'FORMER_MEMBER', maskedNumber: '•••005' },
  ]);
  const form = await openLogin(page);
  await form.getByLabel('Code', { exact: true }).fill('123456');
  await form.getByRole('button', { name: 'Inloggen' }).click();
  await expect(page.getByText('Over welk lidmaatschap gaat je vraag?')).toBeVisible();
  await page.getByRole('button', { name: /TrainMore Utrecht.*Oud-lid.*•••005/ }).click();
  await expect(page.getByText('Je bent ingelogd (TrainMore Utrecht).')).toBeVisible();
  expect(api.requests.find((r) => r.path.endsWith('/login/select'))?.body).toEqual({ index: 1 });
});

test('shows a wrong code', async ({ page }) => {
  await mockApi(page, [needsLogin]);
  const form = await openLogin(page);
  await form.getByLabel('Code', { exact: true }).fill('000000');
  await form.getByRole('button', { name: 'Inloggen' }).click();
  await expect(form.getByText('Die code klopt niet.')).toBeVisible();
});

test('retrying after a failed code request uses a fresh Turnstile token', async ({ page }) => {
  const api = await mockApi(page, [needsLogin]);
  let failed = false;
  await page.route('https://api.test/widget/conversations/*/login/request', async (route) => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      return route.fulfill({
        status: 400,
        headers: { 'access-control-allow-origin': '*' },
        json: { error: 'verification_failed' },
      });
    }
    return route.fallback();
  });
  await page.goto('/?lang=nl');
  await page.getByRole('button', { name: 'Begrepen, start de chat' }).click();
  await page.getByRole('textbox').fill('Wanneer eindigt mijn contract?');
  await page.getByRole('button', { name: 'Versturen' }).click();
  await page.getByRole('button', { name: 'Inloggen' }).click();
  const form = page.getByRole('form', { name: 'Inloggen' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('member@example.com');
  await form.getByRole('button', { name: 'Code versturen' }).click();
  await expect(form.getByText('We konden niet controleren dat je geen robot bent.')).toBeVisible();
  await form.getByRole('button', { name: 'Code versturen' }).click();
  await expect(form.getByText('We hebben een code naar je e-mailadres gestuurd.')).toBeVisible();
  const sent = api.requests.filter((r) => r.path.endsWith('/login/request'));
  expect(sent.map((r) => (r.body as { turnstileToken: string }).turnstileToken)).toEqual([
    'XXXX.DUMMY.TOKEN.2',
  ]);
});
