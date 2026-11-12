import { Writable } from 'node:stream';
import type { Answerer, AnswererResult, LoginDeps, Reply } from '@trainmore/core';
import type {
  AccountCandidate,
  AuthRepository,
  AuthState,
  ConversationRecord,
  ConversationRepository,
  EscalationRepository,
  FaqRepository,
  PortalActor,
  PortalRepository,
  PortalSession,
  ScenarioContent,
  ScenarioRepository,
  ScenarioVersion,
  StoredMessage,
} from '@trainmore/db';
import type { CreateTicketInput } from '@trainmore/freshdesk';
import { createLogger } from '@trainmore/shared';
import type { EntraClaims, EntraClient } from '../src/portal/entra.ts';
import { type ApiDeps, buildApiServer } from '../src/server.ts';

export const ORIGIN = 'https://www.support.trainmore.com';
export const PORTAL_ORIGIN = 'https://chat.example';
export const PORTAL_TENANT = '11111111-1111-4111-8111-111111111111';
export const PORTAL_CLIENT = '22222222-2222-4222-8222-222222222222';
export const CONTACT_URL = 'https://www.support.trainmore.com/en/support/tickets/new';

export function createTestApi(
  options: {
    answer?: AnswererResult | Error;
    turnstileOk?: boolean;
    ticketError?: Error;
    claimError?: Error;
    trustProxyHops?: number;
    recordLeadError?: 'with-conversation' | 'always';
    accounts?: {
      customerId: number;
      studioId: number;
      status: 'MEMBER' | 'PROSPECT' | 'FORMER_MEMBER';
      customerNumber: string | null;
    }[];
    magiclineDown?: boolean;
    /** Portal on, with the claims the fake Entra returns on login. */
    portal?: {
      claims?: Partial<EntraClaims>;
      replayAvailable?: boolean;
      /** Replay judge: answers 'better' for every question (default), fails, or is not configured. */
      judge?: 'ok' | 'fail' | 'off';
    };
    /** Extra Freshdesk tag marking non-production tickets (e.g. chatbot-preprod). */
    envTag?: string;
    /** Synced Freshdesk topics (empty: built-in defaults apply). */
    topics?: string[];
    topicsError?: boolean;
    noteError?: Error;
  } = {},
) {
  const conversations = new Map<
    string,
    ConversationRecord & { turns: StoredMessage[]; claimed: boolean }
  >();
  const leads: { conversationId: string | null; freshdeskTicketId: number; lang: string }[] = [];
  const tickets: CreateTicketInput[] = [];
  const notes: { ticketId: number; text: string }[] = [];
  const escalations: Parameters<EscalationRepository['record']>[0][] = [];
  const answererCalls: Parameters<Answerer>[0][] = [];
  const turnstileIps: string[] = [];
  let logOutput = '';
  let counter = 0;
  let messageIds = 0;
  const replies = new Map<number, string>();
  const feedback: { conversationId: string; messageId: number; rating: 'up' | 'down' }[] = [];

  const conversationRepo: ConversationRepository = {
    async create(input) {
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      conversations.set(id, {
        id,
        tokenHash: input.tokenHash,
        lang: input.lang,
        userMessageCount: 0,
        turns: [],
        claimed: false,
      });
      return { id };
    },
    async get(id) {
      const c = conversations.get(id);
      return c
        ? { id: c.id, tokenHash: c.tokenHash, lang: c.lang, userMessageCount: c.userMessageCount }
        : null;
    },
    async claimTurn(id) {
      if (options.claimError) throw options.claimError;
      const c = conversations.get(id);
      if (!c || c.claimed) return null;
      c.claimed = true;
      return 'claim-1';
    },
    async releaseTurn(id) {
      const c = conversations.get(id);
      if (c) c.claimed = false;
    },
    async listApiHistory() {
      return [];
    },
    async appendTurn(input) {
      const c = conversations.get(input.conversationId);
      if (!c) return null;
      c.turns.push(input.user);
      if (input.assistant) c.turns.push(input.assistant);
      c.userMessageCount += 1;
      c.claimed = false;
      if (!input.assistant) return null;
      messageIds += 1;
      replies.set(messageIds, input.conversationId);
      return messageIds;
    },
    async recordFeedback(conversationId, messageId, rating) {
      if (replies.get(messageId) !== conversationId) return false;
      feedback.push({ conversationId, messageId, rating });
      return true;
    },
    async recordLead(input) {
      if (options.recordLeadError === 'always') throw new Error('db down');
      if (options.recordLeadError === 'with-conversation' && input.conversationId !== null) {
        throw new Error('foreign key violation');
      }
      leads.push(input);
    },
    async recentAssistantOutcomes(id, limit) {
      const turns = conversations.get(id)?.turns ?? [];
      return turns
        .flatMap((m) => (m.outcome === undefined ? [] : [m.outcome]))
        .reverse()
        .slice(0, limit);
    },
    async listTranscript(id) {
      return (conversations.get(id)?.turns ?? []).map((m) => ({
        role: m.outcome === undefined ? ('user' as const) : ('assistant' as const),
        text: m.displayText,
      }));
    },
  };

  const faq: FaqRepository = {
    async getActiveSummaries() {
      return [];
    },
    async getActiveContentHashes() {
      return new Map();
    },
    async countActive() {
      return 0;
    },
    async upsert() {},
    async softDeleteAllExcept() {
      return 0;
    },
    async search() {
      return [];
    },
  };

  const answerer: Answerer = async (input) => {
    answererCalls.push(input);
    const result = options.answer ?? {
      kind: 'answer',
      answer: {
        language: 'en',
        intent: 'wants_human',
        answer: 'x',
        citedArticleIds: [],
        confidence: 'high',
        needsHuman: true,
        approvedAnswerId: null,
      },
      assistantContent: [],
      steps: [],
      toolsUsed: [],
    };
    if (result instanceof Error) throw result;
    return result;
  };

  // In-memory auth repository with the same rules as the SQL functions.
  const sentCodes: { to: string; code: string }[] = [];
  const challenges: {
    id: string;
    conversationId: string;
    emailHash: string;
    codeHash: string;
    attempts: number;
    consumed: boolean;
  }[] = [];
  const authByConversation = new Map<
    string,
    { emailHash: string | null; candidates: AccountCandidate[] | null; bound: number | null }
  >();
  const authOf = (id: string) => {
    const existing = authByConversation.get(id);
    if (existing) return existing;
    const created = { emailHash: null, candidates: null, bound: null };
    authByConversation.set(id, created);
    return created;
  };
  const authRepo: AuthRepository = {
    async createOtpChallenge(input) {
      if (challenges.filter((c) => c.emailHash === input.emailHash).length >= input.maxPerWindow)
        return false;
      challenges.push({ ...input, attempts: 0, consumed: false });
      return true;
    },
    async latestOpenChallengeId(conversationId, emailHash) {
      return (
        challenges
          .filter(
            (c) => c.conversationId === conversationId && c.emailHash === emailHash && !c.consumed,
          )
          .at(-1)?.id ?? null
      );
    },
    async verifyOtpAttempt({ challengeId, conversationId, codeHash, maxAttempts }) {
      const c = challenges.find((x) => x.id === challengeId && x.conversationId === conversationId);
      if (!c || c.consumed) return 'not_found';
      if (c.attempts >= maxAttempts) return 'locked';
      if (c.codeHash === codeHash) {
        c.consumed = true;
        // Mirrors verify_otp_attempt: a new login replaces any earlier binding.
        authByConversation.set(conversationId, {
          emailHash: c.emailHash,
          candidates: null,
          bound: null,
        });
        return 'ok';
      }
      c.attempts += 1;
      return c.attempts >= maxAttempts ? 'locked' : 'invalid';
    },
    async setAccountCandidates(id, candidates) {
      authOf(id).candidates = candidates;
    },
    async bindAccount(id, index) {
      const a = authOf(id);
      if (!a.emailHash || !a.candidates?.[index] || a.bound !== null) return false;
      a.bound = index;
      return true;
    },
    async getAuthState(id): Promise<AuthState> {
      const a = authOf(id);
      const c = a.bound === null ? null : a.candidates?.[a.bound];
      return {
        verified: a.emailHash !== null,
        verifiedEmailHash: a.emailHash,
        candidates: a.candidates,
        account: c ? { customerId: c.customerId, studioId: c.studioId, status: c.status } : null,
      };
    },
  };
  const login: LoginDeps = {
    auth: authRepo,
    email: {
      async sendLoginCode(message) {
        sentCodes.push({ to: message.to, code: message.code });
      },
    },
    magicline: {
      async searchByEmail() {
        if (options.magiclineDown) throw new Error('Magicline 503');
        return (
          options.accounts ?? [
            { customerId: 4, studioId: 1001, status: 'MEMBER', customerNumber: 'M-0004' },
          ]
        );
      },
      async studioName(studioId) {
        return `Club ${studioId}`;
      },
    },
    config: {
      secret: 's'.repeat(32),
      ttlSeconds: 300,
      maxAttempts: 5,
      maxPerWindow: 3,
      windowSeconds: 900,
    },
    logger: createLogger({
      name: 'login-test',
      level: 'info',
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logOutput += chunk.toString();
          callback();
        },
      }),
    }),
  };

  // In-memory portal repository and a fake Entra (the real one is only reached in entra.ts).
  const portalSessions = new Map<string, PortalSession & { expiresAt: Date }>();
  const audits: Parameters<PortalRepository['audit']>[0][] = [];
  const capabilitySwitches: { name: string; enabled: boolean; actor: string }[] = [];
  const entraCalls: { authUrl: unknown[]; redeem: unknown[] } = { authUrl: [], redeem: [] };
  const portalRepo: PortalRepository = {
    async createSession(input) {
      portalSessions.set(input.idHash, {
        userOid: input.userOid,
        displayName: input.displayName,
        roles: input.roles,
        expiresAt: input.expiresAt,
      });
    },
    async getSession(idHash) {
      const session = portalSessions.get(idHash);
      if (!session || session.expiresAt <= new Date()) return null;
      return { userOid: session.userOid, displayName: session.displayName, roles: session.roles };
    },
    async deleteSession(idHash) {
      portalSessions.delete(idHash);
    },
    async audit(entry) {
      audits.push(entry);
    },
    async listFlagged() {
      return [
        {
          conversationId: '00000000-0000-4000-8000-000000000001',
          lang: 'nl',
          lastFlagAt: '2026-11-12T10:00:00Z',
          userMessageCount: 2,
          reasons: ['no_match', 'thumbs_down'],
          escalated: false,
          loggedIn: true,
        },
      ];
    },
    async conversationDetail(id) {
      if (id !== '00000000-0000-4000-8000-000000000001') return null;
      return {
        id,
        lang: 'nl',
        createdAt: '2026-11-12T09:00:00Z',
        loggedIn: true,
        customerStatus: 'MEMBER',
        messages: [
          {
            id: 1,
            role: 'user',
            text: 'Ik ben Sam, mail sam@example.com of bel 0612345678',
            outcome: null,
            citations: [],
            createdAt: '2026-11-12T09:00:00Z',
            rating: null,
          },
          {
            id: 2,
            role: 'assistant',
            text: 'Ik kon hier geen antwoord op vinden.',
            outcome: 'no_match',
            citations: [],
            createdAt: '2026-11-12T09:00:01Z',
            rating: 'down',
          },
        ],
        flags: [{ reason: 'no_match', createdAt: '2026-11-12T09:00:01Z' }],
        escalations: [],
      };
    },
    async listCapabilityFlags() {
      return capabilitySwitches.map((c) => ({
        name: c.name,
        enabled: c.enabled,
        updatedAt: 'now',
      }));
    },
    async setCapability(name, enabled, actor) {
      capabilitySwitches.push({ name, enabled, actor: actor.oid });
      audits.push({
        actor,
        action: 'capability.set',
        entityType: 'capability',
        entityId: name,
        details: { enabled },
      });
    },
  };
  // In-memory approved answers with the same four-eyes rule as publish_scenario_version.
  const scenarioVersions: (ScenarioVersion & { scenarioId: string })[] = [];
  const archivedScenarios = new Set<string>();
  let scenarioCounter = 0;
  const addVersionTo = (scenarioId: string, content: ScenarioContent, actor: PortalActor) => {
    const version = {
      ...content,
      id: scenarioVersions.length + 1,
      scenarioId,
      version: scenarioVersions.filter((v) => v.scenarioId === scenarioId).length + 1,
      status: 'draft' as const,
      authorOid: actor.oid,
      authorName: actor.name,
      createdAt: '2026-11-12T10:00:00Z',
      publishedByName: null,
      publishedAt: null,
    };
    scenarioVersions.push(version);
    return version.id;
  };
  const scenarioRepo: ScenarioRepository = {
    async create(content, actor) {
      scenarioCounter += 1;
      const scenarioId = `00000000-0000-4000-8000-${String(scenarioCounter).padStart(12, '0')}`;
      return { scenarioId, versionId: addVersionTo(scenarioId, content, actor) };
    },
    async addVersion(scenarioId, content, actor) {
      if (
        archivedScenarios.has(scenarioId) ||
        !scenarioVersions.some((v) => v.scenarioId === scenarioId)
      )
        throw Object.assign(new Error('unknown or archived scenario'), { code: 'P0002' });
      return addVersionTo(scenarioId, content, actor);
    },
    async publish(versionId, actor) {
      const v = scenarioVersions.find((x) => x.id === versionId);
      if (!v) return 'not_found';
      if (archivedScenarios.has(v.scenarioId)) return 'archived';
      if (v.authorOid === actor.oid) return 'own_version';
      for (const other of scenarioVersions)
        if (other.scenarioId === v.scenarioId && other.status === 'published')
          other.status = 'superseded';
      v.status = 'published';
      v.publishedByName = actor.name;
      audits.push({
        actor,
        action: 'scenario.publish',
        entityType: 'scenario',
        entityId: v.scenarioId,
      });
      return 'ok';
    },
    async archive(scenarioId) {
      if (
        !scenarioVersions.some((v) => v.scenarioId === scenarioId) ||
        archivedScenarios.has(scenarioId)
      )
        return 'not_found';
      archivedScenarios.add(scenarioId);
      return 'ok';
    },
    async list() {
      return [...new Set(scenarioVersions.map((v) => v.scenarioId))].map((id) => {
        const own = scenarioVersions.filter((v) => v.scenarioId === id);
        return {
          id,
          createdAt: '2026-11-12T10:00:00Z',
          archived: archivedScenarios.has(id),
          latestVersion: own.length,
          latestVersionId: own.at(-1)?.id ?? 0,
          publishedVersion: own.find((v) => v.status === 'published')?.version ?? null,
          firstTriggerNl: own.at(-1)?.triggersNl[0] ?? '',
          firstTriggerEn: own.at(-1)?.triggersEn[0] ?? '',
        };
      });
    },
    async get(scenarioId) {
      const versions = scenarioVersions.filter((v) => v.scenarioId === scenarioId);
      return versions.length
        ? { id: scenarioId, archived: archivedScenarios.has(scenarioId), versions }
        : null;
    },
    async getVersion(versionId) {
      return scenarioVersions.find((v) => v.id === versionId) ?? null;
    },
    async search() {
      return [];
    },
  };
  const replayCalls: unknown[] = [];
  const judgeCalls: unknown[] = [];

  let portalClaims = options.portal?.claims;
  const entra: EntraClient = {
    async authUrl(input) {
      entraCalls.authUrl.push(input);
      return `https://login.example/authorize?state=${input.state}&code_challenge=${input.codeChallenge}`;
    },
    async redeem(input) {
      entraCalls.redeem.push(input);
      return {
        tid: PORTAL_TENANT,
        aud: PORTAL_CLIENT,
        oid: 'oid-agent-1',
        name: 'Agent One',
        roles: ['agent'],
        nonce: input.expectedNonce,
        ...portalClaims,
      };
    },
  };

  const deps: ApiDeps = {
    ...(options.portal
      ? {
          portal: {
            config: {
              tenantId: PORTAL_TENANT,
              clientId: PORTAL_CLIENT,
              clientSecret: 'secret',
              baseUrl: PORTAL_ORIGIN,
              sessionSecret: 'p'.repeat(32),
            },
            entra,
            repo: portalRepo,
            scenarios: scenarioRepo,
            replay:
              options.portal.replayAvailable === false
                ? null
                : async (input) => {
                    replayCalls.push(input);
                    return input.questions.map((question) => ({
                      question,
                      reply: {
                        text: `Nieuw antwoord op: ${question}`,
                        lang: input.pageLang,
                        citations: [],
                        action: 'none' as const,
                        outcome: 'answered' as const,
                        flags: [],
                        scenarioVersionId: input.draft.versionId,
                      },
                    }));
                  },
            judge:
              options.portal.judge === 'off'
                ? null
                : async (input) => {
                    judgeCalls.push(input);
                    if (options.portal?.judge === 'fail') return null;
                    return input.items.map(() => ({
                      verdict: 'better' as const,
                      reason: 'Answers the question.',
                    }));
                  },
          },
        }
      : {}),
    login,
    capabilities: {
      deps: {
        studioClient: async () => ({ getContracts: async () => [{ rateName: 'Flex' }] }) as never, // only contracts are used in API tests
        crossStudioClient: async () => ({}) as never,
        today: () => new Date('2026-11-12T10:00:00Z'),
      },
      disabled: async () => new Set<string>(),
    },
    conversations: conversationRepo,
    faq,
    answerer,
    freshdesk: {
      async createTicket(input) {
        if (options.ticketError) throw options.ticketError;
        tickets.push(input);
        return { id: 777 };
      },
      async addPrivateNote(ticketId, text) {
        if (options.noteError) throw options.noteError;
        notes.push({ ticketId, text });
      },
    },
    escalations: {
      async activeTopics() {
        if (options.topicsError) throw new Error('db down');
        return options.topics ?? [];
      },
      async record(input) {
        escalations.push(input);
      },
    },
    verifyTurnstile: async (_token, remoteIp) => {
      turnstileIps.push(remoteIp);
      return options.turnstileOk ?? true;
    },
    config: {
      allowedOrigins: [ORIGIN],
      supportContactUrl: CONTACT_URL,
      trustProxyHops: options.trustProxyHops ?? 0,
      ...(options.envTag ? { envTag: options.envTag } : {}),
    },
    logger: createLogger({
      name: 'api-test',
      level: 'info',
      destination: new Writable({
        write(chunk, _encoding, callback) {
          logOutput += chunk.toString();
          callback();
        },
      }),
    }),
  };

  return {
    app: buildApiServer(deps),
    sentCodes,
    authState: (id: string) => authRepo.getAuthState(id),
    conversations,
    leads,
    tickets,
    notes,
    escalations,
    feedback,
    portalSessions,
    audits,
    capabilitySwitches,
    entraCalls,
    scenarioVersions,
    replayCalls,
    judgeCalls,
    /** The next portal sign-in returns these claims (a second person on the same server). */
    setPortalClaims(claims: Partial<EntraClaims>) {
      portalClaims = claims;
    },
    answererCalls,
    turnstileIps,
    logs: () => logOutput,
  };
}

export type { Reply };

/** Signs in through the fake Entra (claims from createTestApi({ portal })); returns the session cookie value. */
export async function portalLogin(api: ReturnType<typeof createTestApi>): Promise<string> {
  const start = await api.app.inject({ method: 'GET', url: '/portal/auth/login' });
  const loginCookie = [start.headers['set-cookie'] ?? []]
    .flat()
    .find((c) => c.startsWith('tm_portal_login='))
    ?.split(';')[0];
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const callback = await api.app.inject({
    method: 'GET',
    url: `/portal/auth/callback?code=c&state=${encodeURIComponent(state)}`,
    headers: { cookie: loginCookie ?? '' },
  });
  const session = [callback.headers['set-cookie'] ?? []]
    .flat()
    .find((c) => c.startsWith('tm_portal='))
    ?.split(';')[0]
    ?.slice('tm_portal='.length);
  if (!session) throw new Error(`portal login failed: ${callback.statusCode}`);
  return session;
}
