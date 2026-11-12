import type { Lang } from '@trainmore/i18n';
import { z } from 'zod';

const replySchema = z.object({
  text: z.string(),
  lang: z.enum(['nl', 'en']),
  citations: z.array(z.object({ articleId: z.number(), title: z.string(), url: z.string() })),
  action: z.enum(['none', 'lead_form', 'contact']),
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

export type WidgetApiErrorKind =
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
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => undefined);
    const code = z.object({ error: z.string() }).safeParse(body);
    return code.success && code.data.error === 'verification_failed'
      ? 'verification_failed'
      : 'invalid';
  }
  return 'server';
}

/** Longer than the API's own Claude timeout (2 x 25 s) so real answers still arrive. */
const DEFAULT_TIMEOUT_MS = 60_000;

export function createWidgetApi(opts: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    token?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
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
    async submitLead(input: LeadInput): Promise<void> {
      await post('/widget/leads', input, z.object({ ok: z.literal(true) }));
    },
  };
}

export type WidgetApi = ReturnType<typeof createWidgetApi>;
