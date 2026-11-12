import { expect, type Page, test } from '@playwright/test';
import { mockApi } from './fixtures.ts';

const answer = {
  text: 'Je kunt opzeggen via de app.',
  lang: 'nl' as const,
  citations: [],
  action: 'none' as const,
  messageId: 11,
};

async function startAndAsk(page: Page) {
  await page.goto('/?lang=nl');
  await page.getByRole('button', { name: 'Begrepen, start de chat' }).click();
  await page.getByRole('textbox').fill('Hoe zeg ik op?');
  await page.getByRole('button', { name: 'Versturen' }).click();
  await expect(page.getByText('Je kunt opzeggen via de app.')).toBeVisible();
}

test('feedback: thumbs down sends the rating, can be changed, and says thanks', async ({
  page,
}) => {
  const api = await mockApi(page, [answer]);
  await startAndAsk(page);
  const down = page.getByRole('button', { name: 'Niet nuttig' });
  const up = page.getByRole('button', { name: 'Nuttig', exact: true });
  await down.click();
  await expect(down).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Bedankt voor je feedback.')).toBeVisible();
  await up.click();
  await expect(up).toHaveAttribute('aria-pressed', 'true');
  await expect(down).toHaveAttribute('aria-pressed', 'false');
  const sent = api.requests.filter((r) => r.path.endsWith('/feedback')).map((r) => r.body);
  expect(sent).toEqual([
    { messageId: 11, rating: 'down' },
    { messageId: 11, rating: 'up' },
  ]);
});

test('feedback: no thumbs on replies without an id', async ({ page }) => {
  const { messageId: _none, ...withoutId } = answer;
  await mockApi(page, [withoutId]);
  await startAndAsk(page);
  await expect(page.getByRole('button', { name: 'Niet nuttig' })).toHaveCount(0);
});

test('feedback: in English', async ({ page }) => {
  await mockApi(page, [{ ...answer, lang: 'en', text: 'Cancel in the app.' }]);
  await page.goto('/?lang=en');
  await page.getByRole('button', { name: 'I understand, start chat' }).click();
  await page.getByRole('textbox').fill('How do I cancel?');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Not helpful' }).click();
  await expect(page.getByText('Thanks for your feedback.')).toBeVisible();
});
