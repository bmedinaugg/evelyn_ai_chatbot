import { z } from 'zod';

export const ROLES = ['agent', 'approver', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const FLAG_REASONS = [
  'no_match',
  'low_confidence',
  'invalid_citation',
  'needs_human',
  'wants_human',
  'account_question',
  'refusal',
  'error',
  'thumbs_down',
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

const meSchema = z.object({ name: z.string(), roles: z.array(z.enum(ROLES)) });
export type Me = z.infer<typeof meSchema>;

const flaggedSchema = z.object({
  conversations: z.array(
    z.object({
      conversationId: z.string(),
      lang: z.enum(['nl', 'en']),
      lastFlagAt: z.string(),
      userMessageCount: z.number(),
      reasons: z.array(z.enum(FLAG_REASONS)),
      escalated: z.boolean(),
      loggedIn: z.boolean(),
    }),
  ),
  pageSize: z.number(),
});
export type FlaggedPage = z.infer<typeof flaggedSchema>;

const conversationSchema = z.object({
  id: z.string(),
  lang: z.enum(['nl', 'en']),
  createdAt: z.string(),
  loggedIn: z.boolean(),
  messages: z.array(
    z.object({
      id: z.number(),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      outcome: z.string().nullable(),
      citations: z.array(z.object({ articleId: z.number(), title: z.string(), url: z.string() })),
      createdAt: z.string(),
      rating: z.enum(['up', 'down']).nullable(),
    }),
  ),
  flags: z.array(z.object({ reason: z.enum(FLAG_REASONS), createdAt: z.string() })),
  escalations: z.array(z.object({ topic: z.string(), reason: z.string(), createdAt: z.string() })),
});
export type Conversation = z.infer<typeof conversationSchema>;

const capabilitiesSchema = z.object({
  capabilities: z.array(
    z.object({
      name: z.string(),
      statuses: z.array(z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER'])),
      enabled: z.boolean(),
    }),
  ),
});
export type Capability = z.infer<typeof capabilitiesSchema>['capabilities'][number];

export type PortalApiErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'network' | 'server';

export class PortalApiError extends Error {
  readonly kind: PortalApiErrorKind;
  constructor(kind: PortalApiErrorKind) {
    super(`Portal API error: ${kind}`);
    this.name = 'PortalApiError';
    this.kind = kind;
  }
}

/** Same-origin calls to /portal/api (the session cookie goes along automatically). */
export function createPortalApi(opts: { fetch?: typeof fetch } = {}) {
  const doFetch = opts.fetch ?? fetch.bind(globalThis);

  async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T> | null): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`/portal${path}`, {
        ...init,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PortalApiError('network');
    }
    if (response.status === 401) throw new PortalApiError('unauthorized');
    if (response.status === 403) throw new PortalApiError('forbidden');
    if (response.status === 404) throw new PortalApiError('not_found');
    if (!response.ok) throw new PortalApiError('server');
    if (schema === null) return undefined as T;
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new PortalApiError('server');
    return parsed.data;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    me: () => call('/api/me', {}, meSchema),
    flagged(filter: { reason?: FlagReason; days: number; page: number }) {
      const query = new URLSearchParams({ days: String(filter.days), page: String(filter.page) });
      if (filter.reason) query.set('reason', filter.reason);
      return call(`/api/flagged?${query}`, {}, flaggedSchema);
    },
    conversation: (id: string) =>
      call(`/api/conversations/${encodeURIComponent(id)}`, {}, conversationSchema),
    reveal: (id: string) =>
      call(
        `/api/conversations/${encodeURIComponent(id)}/reveal`,
        { method: 'POST' },
        conversationSchema,
      ),
    capabilities: () => call('/api/capabilities', {}, capabilitiesSchema),
    setCapability: (name: string, enabled: boolean) =>
      call<void>(`/api/capabilities/${encodeURIComponent(name)}`, json('PUT', { enabled }), null),
    logout: () => call<void>('/auth/logout', { method: 'POST' }, null),
  };
}

export type PortalApi = ReturnType<typeof createPortalApi>;
