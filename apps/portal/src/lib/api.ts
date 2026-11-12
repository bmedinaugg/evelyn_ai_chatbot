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

const STATUSES = ['MEMBER', 'PROSPECT', 'FORMER_MEMBER'] as const;
export type ScenarioContent = {
  triggersNl: string[];
  triggersEn: string[];
  answerNl: string;
  answerEn: string;
  statuses: (typeof STATUSES)[number][];
  articleId: number | null;
};

const scenarioListSchema = z.object({
  scenarios: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      archived: z.boolean(),
      latestVersion: z.number(),
      latestVersionId: z.number(),
      publishedVersion: z.number().nullable(),
      firstTriggerNl: z.string(),
      firstTriggerEn: z.string(),
    }),
  ),
});
export type ScenarioSummary = z.infer<typeof scenarioListSchema>['scenarios'][number];

const scenarioSchema = z.object({
  id: z.string(),
  archived: z.boolean(),
  versions: z.array(
    z.object({
      id: z.number(),
      version: z.number(),
      status: z.enum(['draft', 'published', 'superseded', 'withdrawn']),
      triggersNl: z.array(z.string()),
      triggersEn: z.array(z.string()),
      answerNl: z.string(),
      answerEn: z.string(),
      statuses: z.array(z.enum(STATUSES)),
      articleId: z.number().nullable(),
      authorName: z.string(),
      createdAt: z.string(),
      publishedByName: z.string().nullable(),
      publishedAt: z.string().nullable(),
    }),
  ),
});
export type Scenario = z.infer<typeof scenarioSchema>;

const replaySchema = z.object({
  results: z.array(
    z.object({
      question: z.string(),
      oldAnswer: z.string().nullable(),
      newAnswer: z.string(),
      usesDraft: z.boolean(),
      outcome: z.string(),
      action: z.string(),
    }),
  ),
  /** Advisory verdicts of the LLM judge; null when it is unavailable. */
  judgement: z
    .object({
      verdicts: z.array(
        z.object({ verdict: z.enum(['better', 'same', 'worse']), reason: z.string() }),
      ),
      summary: z.object({ better: z.number(), same: z.number(), worse: z.number() }),
    })
    .nullable()
    .default(null),
});
export type ReplayResult = z.infer<typeof replaySchema>;

const metricsFields = {
  conversations: z.number(),
  resolved: z.number(),
  escalations: z.number(),
  thumbsUp: z.number(),
  thumbsDown: z.number(),
  approvedAnswers: z.number(),
  logins: z.number(),
  flags: z.partialRecord(z.enum(FLAG_REASONS), z.number()),
};
const metricsSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(z.object({ day: z.string(), ...metricsFields })),
  totals: z.object(metricsFields),
});
export type Metrics = z.infer<typeof metricsSchema>;
export type DayMetrics = Metrics['days'][number];

const reportSchema = z.object({
  day: z.string(),
  clustered: z.boolean().nullable(),
  topics: z.array(
    z.object({
      labelNl: z.string(),
      labelEn: z.string(),
      count: z.number(),
      conversationIds: z.array(z.string()),
    }),
  ),
});
export type Report = z.infer<typeof reportSchema>;

export type PortalApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'network'
  | 'server';

export class PortalApiError extends Error {
  readonly kind: PortalApiErrorKind;
  /** The server's error code, e.g. `own_version`. */
  readonly code: string | null;
  constructor(kind: PortalApiErrorKind, code: string | null = null) {
    super(`Portal API error: ${kind}`);
    this.name = 'PortalApiError';
    this.kind = kind;
    this.code = code;
  }
}

/** Same-origin calls to /portal/api (the session cookie goes along automatically). */
export function createPortalApi(opts: { fetch?: typeof fetch } = {}) {
  const doFetch = opts.fetch ?? fetch.bind(globalThis);

  async function call<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T> | null,
    timeoutMs = 20_000,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`/portal${path}`, {
        ...init,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PortalApiError('network');
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = (body as { error?: unknown } | null)?.error;
      const code = typeof error === 'string' ? error : null;
      const kind: PortalApiErrorKind =
        response.status === 401
          ? 'unauthorized'
          : response.status === 403
            ? 'forbidden'
            : response.status === 404
              ? 'not_found'
              : response.status === 409
                ? 'conflict'
                : response.status === 400
                  ? 'invalid'
                  : 'server';
      throw new PortalApiError(kind, code);
    }
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
    /** `day` (YYYY-MM-DD, Amsterdam) limits the list to that day and overrides `days`. */
    flagged(filter: { reason?: FlagReason; days: number; page: number; day?: string }) {
      const query = new URLSearchParams({ days: String(filter.days), page: String(filter.page) });
      if (filter.reason) query.set('reason', filter.reason);
      if (filter.day) query.set('day', filter.day);
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
    scenarios: () => call('/api/scenarios', {}, scenarioListSchema),
    scenario: (id: string) => call(`/api/scenarios/${encodeURIComponent(id)}`, {}, scenarioSchema),
    createScenario: (content: ScenarioContent) =>
      call(
        '/api/scenarios',
        json('POST', content),
        z.object({ scenarioId: z.string(), versionId: z.number() }),
      ),
    addVersion: (id: string, content: ScenarioContent) =>
      call(
        `/api/scenarios/${encodeURIComponent(id)}/versions`,
        json('POST', content),
        z.object({ versionId: z.number() }),
      ),
    /** 'own_version' when the four-eyes rule refuses it. */
    async publish(versionId: number): Promise<'ok' | 'own_version'> {
      try {
        await call<void>(`/api/scenario-versions/${versionId}/publish`, { method: 'POST' }, null);
        return 'ok';
      } catch (error) {
        // 403 here is either "not an approver" or "your own version"; the server says which.
        if (error instanceof PortalApiError && error.code === 'own_version') return 'own_version';
        throw error;
      }
    },
    archive: (id: string) =>
      call<void>(`/api/scenarios/${encodeURIComponent(id)}/archive`, { method: 'POST' }, null),
    /** `lang`: the reviewer's language, for the judge's reasons. */
    replay: (conversationId: string, versionId: number, lang: 'nl' | 'en') =>
      call(
        `/api/conversations/${encodeURIComponent(conversationId)}/replay`,
        json('POST', { versionId, lang }),
        replaySchema,
        // Up to 10 answers plus the judge: just under the 60 s CloudFront origin timeout.
        55_000,
      ),
    metrics: (from: string, to: string) =>
      call(`/api/metrics?${new URLSearchParams({ from, to })}`, {}, metricsSchema),
    /** Null when no report was sent for that day. */
    async report(day: string): Promise<Report | null> {
      try {
        return await call(`/api/reports/${encodeURIComponent(day)}`, {}, reportSchema);
      } catch (error) {
        if (error instanceof PortalApiError && error.kind === 'not_found') return null;
        throw error;
      }
    },
  };
}

export type PortalApi = ReturnType<typeof createPortalApi>;
