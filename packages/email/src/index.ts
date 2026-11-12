import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type Lang, t } from '@trainmore/i18n';

export type LoginCodeMessage = { to: string; code: string; lang: Lang; validMinutes: number };

export interface EmailSender {
  sendLoginCode(message: LoginCodeMessage): Promise<void>;
}

export function loginCodeEmail(
  lang: Lang,
  code: string,
  validMinutes: number,
): { subject: string; text: string } {
  return {
    subject: t(lang, 'email.loginCode.subject'),
    text: t(lang, 'email.loginCode.body', { code, minutes: validMinutes }),
  };
}

/** Amazon SES (v2). Plain text only: no tracking pixels or remote images. */
export function createSesEmailSender(opts: {
  client: { send(command: SendEmailCommand): Promise<unknown> };
  from: string;
  configurationSet?: string;
}): EmailSender {
  return {
    async sendLoginCode(message) {
      const { subject, text } = loginCodeEmail(message.lang, message.code, message.validMinutes);
      await opts.client.send(
        new SendEmailCommand({
          FromEmailAddress: opts.from,
          Destination: { ToAddresses: [message.to] },
          ...(opts.configurationSet ? { ConfigurationSetName: opts.configurationSet } : {}),
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: text, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}

/**
 * Local development only: prints the code to the terminal instead of sending an email.
 * Refuses to exist outside APP_ENV=local, so codes can never end up in preprod/prod logs.
 */
export function createLocalOutbox(opts: {
  appEnv: string;
  write?: (line: string) => void;
}): EmailSender {
  if (opts.appEnv !== 'local')
    throw new Error('The local email outbox only works with APP_ENV=local');
  const write = opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  return {
    async sendLoginCode(message) {
      write(`[local outbox] login code (${message.lang}): ${message.code}`);
    },
  };
}
