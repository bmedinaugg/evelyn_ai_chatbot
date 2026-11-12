import type { ServiceConfig } from './service-stack.ts';

/**
 * Non-secret preprod settings (secrets live in Secrets Manager, see docs/DEPLOY.md).
 * Freshdesk ids were read from the live account on 2026-11-12 (docs/api/freshdesk.md).
 */
export const PREPROD_CONFIG: ServiceConfig = {
  portalOrigins: ['https://www.support.trainmore.com'],
  supportContactUrl: 'https://www.support.trainmore.com/nl/support/tickets/new',
  freshdesk: {
    domain: 'urbangymgroup.freshdesk.com',
    portalUrl: 'https://www.support.trainmore.com',
    portalId: '103000108492',
    // The 10 public folders of the TrainMore portal.
    faqFolderIds:
      '103000654097,103000640461,103000640462,103000640466,103000640469,103000640468,103000640467,103000640465,103000640464,103000654099',
    topicField: 'ticket_type',
  },
  chatModel: 'claude-sonnet-5-5',
};
