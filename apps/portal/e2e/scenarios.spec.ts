import { expect, test } from '@playwright/test';
import { CONV, mockPortal, SCENARIO } from './fixtures.ts';

const agent = { name: 'Agent One', roles: ['agent'] };
const approver = { name: 'Approver Two', roles: ['approver'] };

test('lists approved answers with their live version', async ({ page }) => {
  await mockPortal(page, agent);
  await page.goto('/portal/#/scenarios');
  await expect(page.getByRole('heading', { name: 'Goedgekeurde antwoorden' })).toBeVisible();
  const row = page.getByRole('row', { name: /Mag mijn hond mee\?/ });
  await expect(row).toContainText('1');
  await expect(row).toContainText('2');
});

test('an agent drafts a new approved answer in both languages', async ({ page }) => {
  const api = await mockPortal(page, agent);
  await page.goto('/portal/#/scenarios');
  await page.getByRole('link', { name: 'Nieuw goedgekeurd antwoord' }).click();
  await page
    .getByLabel('Voorbeeldvragen (Nederlands), één per regel')
    .fill('Mag ik roken?\nIs roken toegestaan?');
  await page.getByLabel('Voorbeeldvragen (Engels), één per regel').fill('Can I smoke?');
  await page.getByLabel('Antwoord (Nederlands)', { exact: true }).fill('Roken is niet toegestaan.');
  await page.getByLabel('Antwoord (Engels)', { exact: true }).fill('Smoking is not allowed.');
  await page.getByRole('checkbox', { name: 'Lid', exact: true }).check();
  await page.getByRole('button', { name: 'Opslaan als concept' }).click();
  await expect(page.getByText('Opgeslagen als nieuwe conceptversie.')).toBeVisible();
  expect(
    api.requests.find((r) => r.method === 'POST' && r.path === '/portal/api/scenarios')?.body,
  ).toEqual({
    triggersNl: ['Mag ik roken?', 'Is roken toegestaan?'],
    triggersEn: ['Can I smoke?'],
    answerNl: 'Roken is niet toegestaan.',
    answerEn: 'Smoking is not allowed.',
    statuses: ['MEMBER'],
    articleId: null,
  });
});

test("an approver publishes someone else's draft", async ({ page }) => {
  await mockPortal(page, approver);
  await page.goto(`/portal/#/scenarios/${SCENARIO}`);
  const draft = page.getByRole('region', { name: 'Versie 2' });
  await expect(draft).toContainText('Concept');
  await draft.getByRole('button', { name: 'Publiceren' }).click();
  await expect(page.getByText('Gepubliceerd.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Versie 2' })).toContainText('Live');
  await expect(page.getByRole('region', { name: 'Versie 1' })).toContainText('Vervangen');
});

test('nobody publishes their own version', async ({ page }) => {
  await mockPortal(page, { name: 'Someone Else', roles: ['approver'] });
  await page.goto(`/portal/#/scenarios/${SCENARIO}`);
  await page
    .getByRole('region', { name: 'Versie 2' })
    .getByRole('button', { name: 'Publiceren' })
    .click();
  await expect(page.getByRole('alert')).toHaveText(
    'Je kunt je eigen versie niet publiceren; een andere goedkeurder moet dat doen.',
  );
});

test('agents see why they cannot publish', async ({ page }) => {
  await mockPortal(page, agent);
  await page.goto(`/portal/#/scenarios/${SCENARIO}`);
  await expect(
    page.getByText('Alleen goedkeurders en beheerders kunnen publiceren of archiveren.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publiceren' })).toHaveCount(0);
});

test('replays a conversation with a draft, side by side', async ({ page }) => {
  const api = await mockPortal(page, agent);
  await page.goto(`/portal/#/conversations/${CONV}`);
  const panel = page.getByRole('region', { name: 'Testen met een concept' });
  await panel
    .getByLabel('Kies een concept')
    .selectOption({ label: 'Mag mijn hond mee? (versie 2)' });
  await panel.getByRole('button', { name: 'Test uitvoeren' }).click();
  const row = panel.getByRole('row', { name: /Mail me op/ });
  await expect(row).toContainText('Ik kon hier geen betrouwbaar antwoord op vinden.');
  await expect(row).toContainText('Alleen hulphonden zijn toegestaan.');
  await expect(row).toContainText('Gebruikt het concept');
  await expect(row).toContainText('Beter');
  await expect(row).toContainText('Beantwoordt de vraag nu wel.');
  await expect(panel.getByText('1 beter · 0 gelijk · 0 slechter')).toBeVisible();
  expect(api.requests.find((r) => r.path.endsWith('/replay'))?.body).toEqual({
    versionId: 2,
    lang: 'nl',
  });
});

test('says when testing is not available', async ({ page }) => {
  await mockPortal(page, agent, { replayAvailable: false });
  await page.goto(`/portal/#/conversations/${CONV}`);
  const panel = page.getByRole('region', { name: 'Testen met een concept' });
  await panel
    .getByLabel('Kies een concept')
    .selectOption({ label: 'Mag mijn hond mee? (versie 2)' });
  await panel.getByRole('button', { name: 'Test uitvoeren' }).click();
  await expect(panel.getByRole('alert')).toHaveText(
    'Testen kan alleen in preprod en lokaal (testprofielen).',
  );
});
