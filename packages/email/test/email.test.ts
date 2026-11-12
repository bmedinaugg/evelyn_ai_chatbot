import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import { createLocalOutbox, createSesEmailSender, loginCodeEmail } from '../src/index.ts';

describe('loginCodeEmail', () => {
  it('writes the code email in Dutch and English', () => {
    expect(loginCodeEmail('nl', '123456', 5)).toEqual({
      subject: 'Je TrainMore-inlogcode',
      text: 'Je code is 123456. Deze is 5 minuten geldig.\n\nHeb je dit niet aangevraagd? Dan kun je deze e-mail negeren.',
    });
    expect(loginCodeEmail('en', '123456', 5).subject).toBe('Your TrainMore login code');
  });
});

describe('createSesEmailSender', () => {
  it('sends a plain-text email from the configured address', async () => {
    const commands: SendEmailCommand[] = [];
    const sender = createSesEmailSender({
      client: { send: async (command: SendEmailCommand) => void commands.push(command) },
      from: 'TrainMore <no-reply@example.com>',
      configurationSet: 'chatbot',
    });
    await sender.sendLoginCode({
      to: 'lead@example.com',
      code: '123456',
      lang: 'en',
      validMinutes: 5,
    });
    expect(commands[0]?.input).toEqual({
      FromEmailAddress: 'TrainMore <no-reply@example.com>',
      Destination: { ToAddresses: ['lead@example.com'] },
      ConfigurationSetName: 'chatbot',
      Content: {
        Simple: {
          Subject: { Data: 'Your TrainMore login code', Charset: 'UTF-8' },
          Body: { Text: { Data: loginCodeEmail('en', '123456', 5).text, Charset: 'UTF-8' } },
        },
      },
    });
  });
});

describe('createLocalOutbox', () => {
  it('only works with APP_ENV=local and prints the code, not the address', async () => {
    expect(() => createLocalOutbox({ appEnv: 'preprod', write: () => {} })).toThrow(/local/);
    const lines: string[] = [];
    const outbox = createLocalOutbox({ appEnv: 'local', write: (line) => lines.push(line) });
    await outbox.sendLoginCode({
      to: 'lead@example.com',
      code: '654321',
      lang: 'nl',
      validMinutes: 5,
    });
    expect(lines.join('\n')).toContain('654321');
    expect(lines.join('\n')).not.toContain('lead@example.com');
  });
});
