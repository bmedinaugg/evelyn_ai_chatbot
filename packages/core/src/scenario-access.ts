import type { CustomerStatus, ScenarioHit } from '@trainmore/db';

/** An approved answer as offered to the model this turn. */
export type OfferedScenario = ScenarioHit & {
  /** Limited to logged-in customers and this visitor isn't logged in: no answer text is offered. */
  requiresLogin?: boolean;
};

/**
 * Which approved answers this customer may be offered, decided in code before the prompt is built:
 * - no status condition: offered as is;
 * - a condition and not logged in: offered without its text, so the bot can only ask to log in;
 * - logged in with another status: not offered at all.
 */
export function scenariosFor(
  hits: ScenarioHit[],
  status: CustomerStatus | null,
): OfferedScenario[] {
  return hits.flatMap((hit) => {
    if (hit.statuses.length === 0) return [hit];
    if (status === null) return [{ ...hit, answerNl: '', answerEn: '', requiresLogin: true }];
    return hit.statuses.includes(status) ? [hit] : [];
  });
}
