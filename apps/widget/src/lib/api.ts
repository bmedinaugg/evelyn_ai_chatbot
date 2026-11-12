import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';

const replySchema = z.object({
  text: z.string(),
  lang: z.enum(['nl', 'en']),
  citations: z.array(z.object({ articleId: z.number(), title: z.string(), url: z.string() })),
  action: z.enum(['none', 'lead_form', 'ticket_form', 'login']),
  contactUrl: z.string().optional(),
});
export type ApiReply = z.infer<typeof replySchema>;

const sessionSchema = z.object({ conversationId: z.string(), token: z.string() });
export type Session = z.infer<typeof sessionSchema>;

export type LeadInput = {
  email: string;
  phone?: string;
  question: string;
  lang: Lang;
  turnstileToken: string;
  consent: true;
  conversationId?: string;
};

export type TicketInput = {
  email: string;
  name?: string;
  topic: string;
  subject: string;
  description: string;
  lang: Lang;
  turnstileToken: string;
  consent: true;
};

const topicSchema = z.object({ value: z.string(), label: z.string() });
export type TicketTopic = z.infer<typeof topicSchema>;

const accountSchema = z.object({
  index: z.number().int(),
  studioName: z.string(),
  status: z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER']),
  maskedNumber: z.string(),
});
export type AccountChoice = z.infer<typeof accountSchema>;
const verifySchema = z.object({
  accounts: z.array(accountSchema),
  selected: z.number().int().nullable(),
});
export type LoginResult = z.infer<typeof verifySchema>;

const LOGIN_ERRORS = ['invalid_code', 'locked', 'expired'] as const;

export type WidgetApiErrorKind =
  | (typeof LOGIN_ERRORS)[number]
  | 'lookup_failed'
  | 'busy'
  | 'rate_limited'
  | 'not_found'
  | 'verification_failed'
  | 'invalid'
  | 'network'
  | 'server';

export class WidgetApiError extends Error {
  readonly kind: WidgetApiErrorKind;

  constructor(kind: WidgetApiErrorKind) {
    super(`Widget API error: ${kind}`);
    this.name = 'WidgetApiError';
    this.kind = kind;
  }
}

async function errorKind(response: Response): Promise<WidgetApiErrorKind> {
  if (response.status === 409) return 'busy';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 404) return 'not_found';
  const body: unknown = await response.json().catch(() => undefined);
  const code = z.object({ error: z.string() }).safeParse(body);
  const error = code.success ? code.data.error : '';
  if (response.status === 503 && error === 'lookup_failed') return 'lookup_failed';
  if (response.status === 400) {
    if (error === 'verification_failed') return 'verification_failed';
    return LOGIN_ERRORS.find((kind) => kind === error) ?? 'invalid';
  }
  return 'server';
}

/** Longer than the API's own Claude timeout (2 x 25 s) so real answers still arrive. */
const DEFAULT_TIMEOUT_MS = 60_000;

function loginPath(session: Session, step: 'request' | 'verify' | 'lookup' | 'select'): string {
  return `/widget/conversations/${encodeURIComponent(session.conversationId)}/login/${step}`;
}

export function createWidgetApi(opts: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WidgetApiError('network');
    }
    if (!response.ok) throw new WidgetApiError(await errorKind(response));
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new WidgetApiError('server');
    return parsed.data;
  }

  function post<T>(path: string, body: unknown, schema: z.ZodType<T>, token?: string): Promise<T> {
    return call(
      path,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      schema,
    );
  }

  return {
    createConversation(lang: Lang): Promise<Session> {
      return post('/widget/conversations', { lang }, sessionSchema);
    },
    async sendMessage(session: Session, text: string, pageLang: Lang): Promise<ApiReply> {
      const { reply } = await post(
        `/widget/conversations/${encodeURIComponent(session.conversationId)}/messages`,
        { text, pageLang },
        z.object({ reply: replySchema }),
        session.token,
      );
      return reply;
    },
    async requestLoginCode(
      session: Session,
      email: string,
      lang: Lang,
      turnstileToken: string,
    ): Promise<void> {
      await post(
        loginPath(session, 'request'),
        { email, lang, turnstileToken },
        z.object({ ok: z.literal(true) }),
        session.token,
      );
    },
    verifyLoginCode(session: Session, email: string, code: string): Promise<LoginResult> {
      return post(loginPath(session, 'verify'), { email, code }, verifySchema, session.token);
    },
    lookupAccounts(session: Session, email: string): Promise<LoginResult> {
      return post(loginPath(session, 'lookup'), { email }, verifySchema, session.token);
    },
    async selectAccount(session: Session, index: number): Promise<AccountChoice> {
      const { account } = await post(
        loginPath(session, 'select'),
        { index },
        z.object({ account: accountSchema }),
        session.token,
      );
      return account;
    },
    async submitLead(input: LeadInput): Promise<void> {
      await post('/widget/leads', input, z.object({ ok: z.literal(true) }));
    },
    async getTicketTopics(lang: Lang): Promise<TicketTopic[]> {
      const { topics } = await call(
        `/widget/ticket-topics?lang=${lang}`,
        { method: 'GET' },
        z.object({ topics: z.array(topicSchema) }),
      );
      return topics;
    },
    async submitTicket(session: Session, input: TicketInput): Promise<void> {
      await post(
        `/widget/conversations/${encodeURIComponent(session.conversationId)}/tickets`,
        input,
        z.object({ ok: z.literal(true) }),
        session.token,
      );
    },
  };
}

export type WidgetApi = ReturnType<typeof createWidgetApi>;
