import { expect, type Page, test } from '@playwright/test';
import { mockApi } from './fixtures.ts';

const answer = { text: 'Antwoord', lang: 'nl' as const, citations: [], action: 'none' as const };
const leadReply = {
  text: 'Leuk!',
  lang: 'nl' as const,
  citations: [],
  action: 'lead_form' as const,
};

async function startChat(page: Page) {
  await page.goto('/?lang=nl');
  await page.getByRole('button', { name: 'Begrepen, start de chat' }).click();
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox').fill(text);
  await page.getByRole('button', { name: 'Versturen' }).click();
}

async function openLeadForm(page: Page) {
  await startChat(page);
  await ask(page, 'Ik wil lid worden');
  await page.getByRole('button', { name: 'Lid worden' }).click();
}

const loaderPage = (baseURL: string | undefined, inHead = false) => {
  const script = `<script src="${baseURL}/loader.js" data-widget-url="${baseURL}/"></script>`;
  return `<!doctype html><html lang="nl"><head>${inHead ? script : ''}</head><body><p>Portal</p>${inHead ? '' : script}</body></html>`;
};

test('on a phone the launcher does not cover the chat once it is open', async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setContent(loaderPage(baseURL));
  await page.getByRole('button', { name: 'Chat openen' }).click();
  await expect(page.getByRole('button', { name: 'Chat sluiten' })).toBeHidden();
  await expect(page.locator('iframe.tm-chat-frame')).toBeVisible();
});

test('Escape inside the chat closes it', async ({ page, baseURL }) => {
  await page.setContent(loaderPage(baseURL));
  await page.getByRole('button', { name: 'Chat openen' }).click();
  const frame = page.frameLocator('iframe.tm-chat-frame');
  await frame.getByRole('button', { name: 'Begrepen, start de chat' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('iframe.tm-chat-frame')).toBeHidden();
});

test('the loader also works when placed in <head>', async ({ page, baseURL }) => {
  await page.setContent(loaderPage(baseURL, true));
  await expect(page.getByRole('button', { name: 'Chat openen' })).toBeVisible();
});

test('new chat is not possible while a reply is pending', async ({ page }) => {
  await mockApi(page, [answer, answer]);
  // Each message request waits on the gate that is current when it arrives.
  let open: () => void = () => {};
  let gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  await page.route('https://api.test/widget/conversations/*/messages', async (route) => {
    await gate;
    await route.fallback();
  });
  await startChat(page);
  await ask(page, 'eerste');
  open();
  await expect(page.getByText('Antwoord', { exact: true })).toBeVisible();
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  await ask(page, 'tweede');
  await expect(page.getByRole('button', { name: 'Nieuwe chat' })).toBeDisabled();
  open();
  await expect(page.getByRole('button', { name: 'Nieuwe chat' })).toBeEnabled();
});

test('primary buttons use dark text on red for contrast', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/?lang=nl');
  const color = await page
    .getByRole('button', { name: 'Begrepen, start de chat' })
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(0, 0, 0)');
});

test('lead form: a phone number the server would reject is blocked in the browser', async ({
  page,
}) => {
  const api = await mockApi(page, [leadReply]);
  await openLeadForm(page);
  const form = page.getByRole('form', { name: 'Lid worden' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('lead@example.com');
  await form.getByLabel('Telefoonnummer (optioneel)').fill('06.12345678');
  await form.getByLabel('Je vraag', { exact: true }).fill('Vraag');
  await form.getByLabel('TrainMore mag contact met me opnemen over mijn vraag.').check();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await page.waitForTimeout(200);
  expect(api.requests.filter((r) => r.path === '/widget/leads')).toHaveLength(0);
});

test('lead form: a question of only spaces is not sent', async ({ page }) => {
  const api = await mockApi(page, [leadReply]);
  await openLeadForm(page);
  const form = page.getByRole('form', { name: 'Lid worden' });
  await form.getByLabel('E-mailadres', { exact: true }).fill('lead@example.com');
  await form.getByLabel('Je vraag', { exact: true }).fill('   ');
  await form.getByLabel('TrainMore mag contact met me opnemen over mijn vraag.').check();
  await form.getByRole('button', { name: 'Versturen' }).click();
  await expect(page.getByText('Controleer je e-mailadres, telefoonnummer en vraag.')).toBeVisible();
  expect(api.requests.filter((r) => r.path === '/widget/leads')).toHaveLength(0);
});

test('lead form: when verification cannot load, says so and retries on reopen', async ({
  page,
}) => {
  await mockApi(page, [leadReply]);
  let scriptRequests = 0;
  await page.route('https://challenges.cloudflare.com/**', (route) => {
    scriptRequests += 1;
    return route.fulfill({ status: 503, body: 'down' });
  });
  await openLeadForm(page);
  await expect(page.getByText('De controle kon niet laden.')).toBeVisible();
  await page.getByRole('button', { name: 'Annuleren' }).click();
  await page.getByRole('button', { name: 'Lid worden' }).click();
  await expect.poll(() => scriptRequests).toBe(2);
});
