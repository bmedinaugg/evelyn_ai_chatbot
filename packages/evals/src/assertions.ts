import type { Reply, ReplyAction } from '@trainmore/core';
import type { Outcome } from '@trainmore/db';
import type { Lang } from '@trainmore/i18n';

export type Expectation = {
  outcome?: Outcome[];
  action?: ReplyAction;
  citesAnyOf?: number[];
  citesNone?: true;
  replyLang?: Lang;
  /** Checked against the reply text and the cited titles/urls. */
  mustNotMatch?: RegExp[];
};

/** Returns one message per failed expectation (empty = pass). */
export function checkReply(reply: Reply, expect: Expectation): string[] {
  const failures: string[] = [];
  const cited = reply.citations.map((c) => c.articleId);
  if (expect.outcome && !expect.outcome.includes(reply.outcome)) {
    failures.push(`outcome ${reply.outcome} not in [${expect.outcome.join(', ')}]`);
  }
  if (expect.action && reply.action !== expect.action) {
    failures.push(`action ${reply.action} !== ${expect.action}`);
  }
  if (expect.citesAnyOf && !cited.some((id) => expect.citesAnyOf?.includes(id))) {
    failures.push(`cited [${cited.join(', ')}], expected any of [${expect.citesAnyOf.join(', ')}]`);
  }
  if (expect.citesNone && cited.length > 0) {
    failures.push(`cited [${cited.join(', ')}], expected none`);
  }
  if (expect.replyLang && reply.lang !== expect.replyLang) {
    failures.push(`replied in ${reply.lang}, expected ${expect.replyLang}`);
  }
  const visible = [reply.text, ...reply.citations.flatMap((c) => [c.title, c.url])].join('\n');
  for (const pattern of expect.mustNotMatch ?? []) {
    if (pattern.test(visible)) failures.push(`reply matches forbidden ${pattern}`);
  }
  return failures;
}
