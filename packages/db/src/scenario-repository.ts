import { z } from 'zod';
import { DbError, type ServiceClient } from './client.ts';
import type { CustomerStatus } from './conversation-types.ts';
import type { PortalActor } from './portal-repository.ts';

/** What staff write; every change is a new immutable version. */
export type ScenarioContent = {
  triggersNl: string[];
  triggersEn: string[];
  answerNl: string;
  answerEn: string;
  /** Empty: everyone. Otherwise only logged-in customers with one of these statuses. */
  statuses: CustomerStatus[];
  articleId: number | null;
};

export type ScenarioVersionStatus = 'draft' | 'published' | 'superseded' | 'withdrawn';
export type PublishResult = 'ok' | 'not_found' | 'own_version' | 'archived' | 'not_publishable';

export type ScenarioVersion = ScenarioContent & {
  id: number;
  version: number;
  status: ScenarioVersionStatus;
  authorOid: string;
  authorName: string;
  createdAt: string;
  publishedByName: string | null;
  publishedAt: string | null;
};

export type ScenarioSummary = {
  id: string;
  createdAt: string;
  archived: boolean;
  latestVersion: number;
  /** Id of the latest version (e.g. the draft to replay). */
  latestVersionId: number;
  publishedVersion: number | null;
  /** Of the latest version, for the list. */
  firstTriggerNl: string;
  firstTriggerEn: string;
};

/** A published answer found for a customer question. */
export type ScenarioHit = {
  versionId: number;
  scenarioId: string;
  triggers: string[];
  answerNl: string;
  answerEn: string;
  statuses: CustomerStatus[];
  articleId: number | null;
  /** The linked help article when it is still active, in the asked language. */
  article: { title: string; url: string } | null;
};

export interface ScenarioRepository {
  create(
    content: ScenarioContent,
    actor: PortalActor,
  ): Promise<{ scenarioId: string; versionId: number }>;
  addVersion(scenarioId: string, content: ScenarioContent, actor: PortalActor): Promise<number>;
  /** Four eyes: never by the version's author (checked in SQL). */
  publish(versionId: number, actor: PortalActor): Promise<PublishResult>;
  archive(scenarioId: string, actor: PortalActor): Promise<'ok' | 'not_found'>;
  list(): Promise<ScenarioSummary[]>;
  get(
    scenarioId: string,
  ): Promise<{ id: string; archived: boolean; versions: ScenarioVersion[] } | null>;
  getVersion(versionId: number): Promise<(ScenarioVersion & { scenarioId: string }) | null>;
  search(query: string, lang: 'nl' | 'en', limit: number): Promise<ScenarioHit[]>;
}

const statusesSchema = z.array(z.enum(['MEMBER', 'PROSPECT', 'FORMER_MEMBER']));
const versionRow = z.object({
  id: z.number(),
  scenario_id: z.string(),
  version: z.number(),
  triggers_nl: z.array(z.string()),
  triggers_en: z.array(z.string()),
  answer_nl: z.string(),
  answer_en: z.string(),
  statuses: statusesSchema,
  article_id: z.number().nullable(),
  author_oid: z.string(),
  author_name: z.string(),
  created_at: z.string(),
  status: z.enum(['draft', 'published', 'superseded', 'withdrawn']),
  published_by_name: z.string().nullable(),
  published_at: z.string().nullable(),
});
const VERSION_COLUMNS =
  'id, scenario_id, version, triggers_nl, triggers_en, answer_nl, answer_en, statuses, article_id, author_oid, author_name, created_at, status, published_by_name, published_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toVersion(row: z.infer<typeof versionRow>): ScenarioVersion & { scenarioId: string } {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    version: row.version,
    triggersNl: row.triggers_nl,
    triggersEn: row.triggers_en,
    answerNl: row.answer_nl,
    answerEn: row.answer_en,
    statuses: row.statuses,
    articleId: row.article_id,
    authorOid: row.author_oid,
    authorName: row.author_name,
    createdAt: row.created_at,
    status: row.status,
    publishedByName: row.published_by_name,
    publishedAt: row.published_at,
  };
}

/** The JSON shape the SQL functions read (see the scenarios migration). */
const contentJson = (content: ScenarioContent) => JSON.parse(JSON.stringify(content));

export function createSupabaseScenarioRepository(client: ServiceClient): ScenarioRepository {
  return {
    async create(content, actor) {
      const { data, error } = await client.rpc('create_scenario', {
        p_actor_oid: actor.oid,
        p_actor_name: actor.name,
        p_content: contentJson(content),
      });
      if (error) throw new DbError('create_scenario', error.code);
      const [row] = z
        .array(z.object({ scenario_id: z.string(), version_id: z.number() }))
        .parse(data);
      if (!row) throw new DbError('create_scenario', 'no_row');
      return { scenarioId: row.scenario_id, versionId: row.version_id };
    },

    async addVersion(scenarioId, content, actor) {
      const { data, error } = await client.rpc('add_scenario_version', {
        p_scenario_id: scenarioId,
        p_actor_oid: actor.oid,
        p_actor_name: actor.name,
        p_content: contentJson(content),
      });
      if (error) throw new DbError('add_scenario_version', error.code);
      return z.number().parse(data);
    },

    async publish(versionId, actor) {
      const { data, error } = await client.rpc('publish_scenario_version', {
        p_version_id: versionId,
        p_actor_oid: actor.oid,
        p_actor_name: actor.name,
      });
      if (error) throw new DbError('publish_scenario_version', error.code);
      return z.enum(['ok', 'not_found', 'own_version', 'archived', 'not_publishable']).parse(data);
    },

    async archive(scenarioId, actor) {
      if (!UUID.test(scenarioId)) return 'not_found';
      const { data, error } = await client.rpc('archive_scenario', {
        p_scenario_id: scenarioId,
        p_actor_oid: actor.oid,
        p_actor_name: actor.name,
      });
      if (error) throw new DbError('archive_scenario', error.code);
      return z.enum(['ok', 'not_found']).parse(data);
    },

    async list() {
      const [scenarios, versions] = await Promise.all([
        client
          .from('scenarios')
          .select('id, created_at, archived_at')
          .order('created_at', { ascending: false }),
        client
          .from('scenario_versions')
          .select('id, scenario_id, version, status, triggers_nl, triggers_en')
          .order('version', { ascending: true }),
      ]);
      if (scenarios.error) throw new DbError('scenarios select', scenarios.error.code);
      if (versions.error) throw new DbError('scenario_versions select', versions.error.code);
      return (scenarios.data ?? []).flatMap((s) => {
        const own = (versions.data ?? []).filter((v) => v.scenario_id === s.id);
        const latest = own.at(-1);
        if (!latest) return [];
        return [
          {
            id: s.id,
            createdAt: s.created_at,
            archived: s.archived_at !== null,
            latestVersion: latest.version,
            latestVersionId: latest.id,
            publishedVersion: own.find((v) => v.status === 'published')?.version ?? null,
            firstTriggerNl: latest.triggers_nl[0] ?? '',
            firstTriggerEn: latest.triggers_en[0] ?? '',
          },
        ];
      });
    },

    async get(scenarioId) {
      if (!UUID.test(scenarioId)) return null;
      const scenario = await client
        .from('scenarios')
        .select('id, archived_at')
        .eq('id', scenarioId)
        .maybeSingle();
      if (scenario.error) throw new DbError('scenarios select', scenario.error.code);
      if (!scenario.data) return null;
      const versions = await client
        .from('scenario_versions')
        .select(VERSION_COLUMNS)
        .eq('scenario_id', scenarioId)
        .order('version', { ascending: true });
      if (versions.error) throw new DbError('scenario_versions select', versions.error.code);
      return {
        id: scenario.data.id,
        archived: scenario.data.archived_at !== null,
        versions: z
          .array(versionRow)
          .parse(versions.data ?? [])
          .map(toVersion),
      };
    },

    async getVersion(versionId) {
      const { data, error } = await client
        .from('scenario_versions')
        .select(VERSION_COLUMNS)
        .eq('id', versionId)
        .maybeSingle();
      if (error) throw new DbError('scenario_versions select', error.code);
      return data ? toVersion(versionRow.parse(data)) : null;
    },

    async search(query, lang, limit) {
      const { data, error } = await client.rpc('search_scenarios', {
        query,
        preferred_lang: lang,
        max_results: limit,
      });
      if (error) throw new DbError('search_scenarios', error.code);
      return z
        .array(
          z.object({
            version_id: z.number(),
            scenario_id: z.string(),
            triggers: z.array(z.string()),
            answer_nl: z.string(),
            answer_en: z.string(),
            statuses: statusesSchema,
            article_id: z.number().nullable(),
            article_title: z.string().nullable(),
            article_url: z.string().nullable(),
          }),
        )
        .parse(data ?? [])
        .map((row) => ({
          versionId: row.version_id,
          scenarioId: row.scenario_id,
          triggers: row.triggers,
          answerNl: row.answer_nl,
          answerEn: row.answer_en,
          statuses: row.statuses,
          articleId: row.article_id,
          article:
            row.article_title && row.article_url
              ? { title: row.article_title, url: row.article_url }
              : null,
        }));
    },
  };
}
