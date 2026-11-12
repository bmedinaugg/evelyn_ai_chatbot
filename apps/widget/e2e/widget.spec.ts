import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures.ts';

const answer = {
  text: 'Je kunt opzeggen via de app.',
  lang: 'nl' as const,
  citations: [
    {
      articleId: 900101,
      title: 'Hoe zeg ik op?',
      url: 'https://www.support.trainmore.com/nl/support/solutions/articles/900101',
    },
  ],
  action: 'none' as const,
};

async function startChat(page: import('@playwright/test').Page, lang = 'nl') {
  await page.goto(`/?lang=${lang}`);
  await page
    .getByRole('button', {
      name: lang === 'nl' ? 'Begrepen, start de chat' : 'I understand, start chat',
    })
    .click();
}

async function ask(page: import('@playwright/test').Page, text: string) {
  await page.getByRole('textbox').fill(text);
  await page.getByRole('button', { name: /Versturen|Send/ }).click();
}

test('shows the consent notice and makes no API call before accepting', async ({ page }) => {
  const api = await mockApi(page, [answer]);
  await page.goto('/?lang=nl');
  await expect(page.getByText('Deze chat gebruikt AI')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacyverklaring' })).toHaveAttribute(
    'href',
    'https://www.trainmore.nl/privacy',
  );
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(api.requests).toHaveLength(0);
});

test('answers a question with a source link', async ({ page }) => {
  const api = await mockApi(page, [answer]);
  await startChat(page);
  await ask(page, 'Hoe zeg ik mijn lidmaatschap op?');
  await expect(page.getByText('Je kunt opzeggen via de app.')).toBeVisible();
  const link = page.getByRole('link', { name: 'Hoe zeg ik op?' });
  await expect(link).toHaveAttribute('href', answer.citations[0]?.url ?? '');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(api.requests.map((r) => r.path)).toEqual([
    '/widget/conversations',
    '/widget/conversations/00000000-0000-4000-8000-000000000001/messages',
  ]);
  expect(api.requests[1]?.body).toEqual({
    text: 'Hoe zeg ik mijn lidmaatschap op?',
    pageLang: 'nl',
  });
});

test('shows a hand-off contact link', async ({ page }) => {
  await mockApi(page, [
    {
      text: 'Ons supportteam helpt je graag verder.',
      lang: 'nl',
      citations: [],
      action: 'ticket_form',
      contactUrl: 'https://www.support.trainmore.com/nl/support/tickets/new',
    },
  ]);
  await startChat(page);
  await ask(page, 'Iets lastigs');
  await expect(
    page.getByRole('link', { name: 'Neem contact op met ons supportteam' }),
  ).toHaveAttribute('href', 'https://www.support.trainmore.com/nl/support/tickets/new');
});

test('renders HTML in replies as text and drops unsafe links', async ({ page }) => {
  await mockApi(page, [
    {
      text: '<img src=x onerror="window.pwned=1">Hallo',
      lang: 'nl',
      citations: [{ articleId: 1, title: '<b>Evil</b>', url: 'javascript:window.pwned=2' }],
      action: 'none',
    },
  ]);
  await startChat(page);
  await ask(page, 'test');
  await expect(page.getByText('<img src=x onerror="window.pwned=1">Hallo')).toBeVisible();
  await expect(page.getByText('<b>Evil</b>')).toBeVisible();
  await expect(page.getByRole('link', { name: '<b>Evil</b>' })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
});

test('a busy reply shows a notice without duplicating the message', async ({ page }) => {
  await mockApi(page, [409]);
  await startChat(page);
  await ask(page, 'Nog een vraag');
  await expect(page.getByText('Ik ben nog bezig met je vorige vraag.')).toBeVisible();
  await expect(page.getByText('Nog een vraag')).toHaveCount(1);
});

test('an expired conversation starts a new one and resends once', async ({ page }) => {
  const api = await mockApi(page, [404, answer]);
  await startChat(page);
  await ask(page, 'Hoe zeg ik op?');
  await expect(page.getByText('Je kunt opzeggen via de app.')).toBeVisible();
  expect(api.requests.map((r) => r.path)).toEqual([
    '/widget/conversations',
    '/widget/conversations/00000000-0000-4000-8000-000000000001/messages',
    '/widget/conversations',
    '/widget/conversations/00000000-0000-4000-8000-000000000002/messages',
  ]);
});

test('lead form: submits with the Turnstile token', async ({ page }) => {
  const api = await mockApi(page, [
    { text: 'Leuk dat je interesse hebt!', lang: 'nl', citations: [], action: 'lead_form' },
  ]);
  await startChat(page);
  await ask(page, 'Ik wil lid worden');
  await page.getByRole('button', { name: 'Lid worden' }).click();
  await page.getByLabel('E-mailadres', { exact: true }).fill('lead@example.com');
  await page.getByLabel('Je vraag', { exact: true }).fill('Wat kost het?');
  await page.getByLabel('TrainMore mag contact met me opnemen over mijn vraag.').check();
  await page
    .getByRole('form', { name: 'Lid worden' })
    .getByRole('button', { name: 'Versturen' })
    .click();
  await expect(
    page.getByText('Bedankt! We hebben je vraag ontvangen en reageren per e-mail.'),
  ).toBeVisible();
  const lead = api.requests.find((r) => r.path === '/widget/leads');
  expect(lead?.body).toMatchObject({
    email: 'lead@example.com',
    question: 'Wat kost het?',
    lang: 'nl',
    consent: true,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  });
});

test('lead form: shows a verification failure', async ({ page }) => {
  await mockApi(page, [{ text: 'Leuk!', lang: 'nl', citations: [], action: 'lead_form' }], 400);
  await startChat(page);
  await ask(page, 'Ik wil lid worden');
  await page.getByRole('button', { name: 'Lid worden' }).click();
  await page.getByLabel('E-mailadres', { exact: true }).fill('lead@example.com');
  await page.getByLabel('Je vraag', { exact: true }).fill('Vraag');
  await page.getByLabel('TrainMore mag contact met me opnemen over mijn vraag.').check();
  await page
    .getByRole('form', { name: 'Lid worden' })
    .getByRole('button', { name: 'Versturen' })
    .click();
  await expect(page.getByText('We konden niet controleren dat je geen robot bent.')).toBeVisible();
});

test('scrolls to the newest message', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 600 });
  const long = { ...answer, text: 'Lang antwoord. '.repeat(20) };
  await mockApi(page, [long, long, { ...answer, text: 'Laatste antwoord' }]);
  await startChat(page);
  for (const q of ['een', 'twee', 'drie']) {
    await ask(page, q);
    await expect(page.getByRole('textbox')).toBeEnabled();
  }
  await expect(page.getByText('Laatste antwoord')).toBeInViewport();
});

test('uses English when the page language is en', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/?lang=en');
  await expect(page.getByRole('button', { name: 'I understand, start chat' })).toBeVisible();
});

test('the loader adds a launcher that opens and closes the chat', async ({ page, baseURL }) => {
  await page.setContent(
    `<!doctype html><html lang="en"><body><script src="${baseURL}/loader.js" data-widget-url="${baseURL}/"></script></body></html>`,
  );
  const launcher = page.getByRole('button', { name: 'Open chat' });
  await expect(launcher).toBeVisible();
  const frame = page.locator('iframe.tm-chat-frame');
  await expect(frame).toBeHidden();
  await launcher.click();
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', `${baseURL}/?lang=en`);
  await page
    .frameLocator('iframe.tm-chat-frame')
    .getByRole('button', { name: 'Close chat' })
    .click();
  await expect(frame).toBeHidden();
});
