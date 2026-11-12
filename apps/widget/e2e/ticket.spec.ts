import { expect, type Page, test } from '@playwright/test';
import { mockApi } from './fixtures.ts';

const handoff = {
  text: 'Natuurlijk. Vul het formulier hieronder in, dan neemt ons supportteam per e-mail contact met je op.',
  lang: 'nl' as const,
  citations: [],
  action: 'ticket_form' as const,
  contactUrl: 'https://www.support.trainmore.com/nl/support/tickets/new',
};

async function startChat(page: Page) {
  await page.goto('/?lang=nl');
  await page.getByRole('button', { name: 'Begrepen, start de chat' }).click();
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox').fill(text);
  await page.getByRole('button', { name: 'Versturen' }).click();
}

const ticketForm = (page: Page) => page.getByRole('form', { name: 'Contact met support' });

test('ticket form: prefilled from the chat, sent with topic and Turnstile token', async ({
  page,
}) => {
  const api = await mockApi(page, [handoff]);
  await startChat(page);
  await ask(page, 'Ik ben twee keer afgeschreven');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const form = ticketForm(page);
  await expect(form.getByLabel('Onderwerp', { exact: true })).toHaveValue(
    'Ik ben twee keer afgeschreven',
  );
  await expect(form.getByLabel('Je bericht', { exact: true })).toHaveValue(
    'Ik ben twee keer afgeschreven',
  );
  await form
    .getByLabel('Categorie', { exact: true })
    .selectOption({ label: 'Betalingen & facturen' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('sam@example.com');
  await form
    .getByLabel(
      'TrainMore mag dit chatgesprek delen met het supportteam om mijn vraag te behandelen.',
    )
    .check();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await expect(
    page.getByText('Bedankt! Ons supportteam heeft je bericht ontvangen en reageert per e-mail.'),
  ).toBeVisible();
  await expect(ticketForm(page)).toHaveCount(0);

  const ticket = api.requests.find((r) => r.path.endsWith('/tickets'));
  expect(ticket?.path).toBe('/widget/conversations/00000000-0000-4000-8000-000000000001/tickets');
  expect(ticket?.body).toEqual({
    email: 'sam@example.com',
    topic: 'Payments & invoices',
    subject: 'Ik ben twee keer afgeschreven',
    description: 'Ik ben twee keer afgeschreven',
    lang: 'nl',
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    consent: true,
  });
  // The contact page stays available as a fallback.
  await expect(
    page.getByRole('link', { name: 'Neem contact op met ons supportteam' }),
  ).toBeVisible();
});

test('ticket form: needs a topic before sending', async ({ page }) => {
  const api = await mockApi(page, [handoff]);
  await startChat(page);
  await ask(page, 'Vraag');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const form = ticketForm(page);
  await form.getByLabel('E-mailadres', { exact: true }).fill('sam@example.com');
  await form
    .getByLabel(
      'TrainMore mag dit chatgesprek delen met het supportteam om mijn vraag te behandelen.',
    )
    .check();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await expect(form).toBeVisible();
  expect(api.requests.some((r) => r.path.endsWith('/tickets'))).toBe(false);
});

test('ticket form: shows a verification failure and gets a new token', async ({ page }) => {
  const api = await mockApi(page, [handoff], 201, undefined, 400);
  await startChat(page);
  await ask(page, 'Vraag');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const form = ticketForm(page);
  await form
    .getByLabel('Categorie', { exact: true })
    .selectOption({ label: 'Lidmaatschap & contract' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('sam@example.com');
  await form
    .getByLabel(
      'TrainMore mag dit chatgesprek delen met het supportteam om mijn vraag te behandelen.',
    )
    .check();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await expect(form.getByText('We konden niet controleren dat je geen robot bent.')).toBeVisible();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await expect.poll(() => api.requests.filter((r) => r.path.endsWith('/tickets')).length).toBe(2);
  const tokens = api.requests
    .filter((r) => r.path.endsWith('/tickets'))
    .map((r) => (r.body as { turnstileToken: string }).turnstileToken);
  expect(new Set(tokens).size).toBe(2);
});

const needsLogin = {
  text: 'Om vragen over je account te beantwoorden, log je eerst in met je e-mailadres.',
  lang: 'nl' as const,
  citations: [],
  action: 'login' as const,
};

async function logIn(page: Page) {
  await ask(page, 'Wanneer eindigt mijn contract?');
  await page.getByRole('button', { name: 'Inloggen' }).click();
  const login = page.getByRole('form', { name: 'Inloggen' });
  await login.getByLabel('E-mailadres', { exact: true }).fill('member@example.com');
  await login.getByRole('button', { name: 'Code versturen' }).click();
  await login.getByLabel('Code', { exact: true }).fill('123456');
  await login.getByRole('button', { name: 'Inloggen' }).click();
  await expect(page.getByText('Je bent ingelogd (TrainMore Amsterdam).')).toBeVisible();
}

test('ticket form: the verified email stays prefilled after a page reload', async ({ page }) => {
  await mockApi(page, [needsLogin, handoff]);
  await startChat(page);
  await logIn(page);
  await page.reload();
  await ask(page, 'Ik wil een mens spreken');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const email = ticketForm(page).getByLabel('E-mailadres', { exact: true });
  await expect(email).toHaveValue('member@example.com');
  await expect(email).toHaveAttribute('readonly', '');
});

test('lead form: the verified email is prefilled but editable', async ({ page }) => {
  await mockApi(page, [
    needsLogin,
    { text: 'Leuk!', lang: 'nl', citations: [], action: 'lead_form' },
  ]);
  await startChat(page);
  await logIn(page);
  await ask(page, 'Ik wil een extra lidmaatschap');
  await page.getByRole('button', { name: 'Lid worden' }).click();
  const email = page
    .getByRole('form', { name: 'Lid worden' })
    .getByLabel('E-mailadres', { exact: true });
  await expect(email).toHaveValue('member@example.com');
  await expect(email).not.toHaveAttribute('readonly', '');
});

test('ticket form: a new chat forgets the verified email', async ({ page }) => {
  await mockApi(page, [needsLogin, handoff]);
  await startChat(page);
  await logIn(page);
  await page.getByRole('button', { name: 'Nieuwe chat' }).click();
  await page.reload();
  await ask(page, 'Ik wil een mens spreken');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const email = ticketForm(page).getByLabel('E-mailadres', { exact: true });
  await expect(email).toHaveValue('');
  await expect(email).not.toHaveAttribute('readonly', '');
});

test('ticket form: the verified email is prefilled and locked', async ({ page }) => {
  await mockApi(page, [needsLogin, handoff]);
  await startChat(page);
  await logIn(page);
  await ask(page, 'Ik wil een mens spreken');
  await page.getByRole('button', { name: 'Contact met support' }).click();
  const email = ticketForm(page).getByLabel('E-mailadres', { exact: true });
  await expect(email).toHaveValue('member@example.com');
  await expect(email).toHaveAttribute('readonly', '');
});

test('ticket form: in English', async ({ page }) => {
  await mockApi(page, [{ ...handoff, lang: 'en', text: 'Of course.' }]);
  await page.goto('/?lang=en');
  await page.getByRole('button', { name: 'I understand, start chat' }).click();
  await page.getByRole('textbox').fill('I need help');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Contact support' }).click();
  const form = page.getByRole('form', { name: 'Contact support' });
  await expect(form.getByLabel('Topic', { exact: true })).toBeVisible();
  await expect(form.getByRole('option', { name: 'Payments & invoices' })).toHaveCount(1);
});
