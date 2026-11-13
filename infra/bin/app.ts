import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { PREPROD_CONFIG } from '../lib/preprod-config.ts';
import { ServiceStack } from '../lib/service-stack.ts';
import { WafStack } from '../lib/waf-stack.ts';
import { WorkerStack } from '../lib/worker-stack.ts';

const app = new App();

/** Required context value (`cdk deploy -c key=value`); fails synth when missing. */
function context(key: string): string {
  const value: unknown = app.node.tryGetContext(key);
  if (typeof value !== 'string' || value === '') throw new Error(`Missing CDK context: ${key}`);
  return value;
}

// Only preprod is deployed until M6 (production go-live).
const env = { region: 'eu-west-1' };
const foundation = new FoundationStack(app, 'TrainmoreChatbot-preprod', {
  envName: 'preprod',
  env,
  emailFrom: context('emailFrom'),
});
// WAF (CloudFront web ACLs live in us-east-1; the ARN is passed across regions). Off in preprod
// to save about $10/month: light use, app rate limits, Turnstile and the API off most of the
// time. On with -c waf=on (production always has it).
const waf =
  app.node.tryGetContext('waf') === 'on'
    ? new WafStack(app, 'TrainmoreChatbot-preprod-waf', {
        envName: 'preprod',
        env: { region: 'us-east-1' },
        crossRegionReferences: true,
      })
    : undefined;
const service = new ServiceStack(app, 'TrainmoreChatbot-preprod-service', {
  envName: 'preprod',
  env,
  ...(waf ? { crossRegionReferences: true, webAclArn: waf.webAclArn } : {}),
  foundation,
  // The API runs only when switched on (workflow "Preprod on/off"); off every day at 20:00.
  onDemand: { stopHour: 20 },
  imageTag: context('imageTag'),
  // Built by the deploy workflow with VITE_API_BASE_URL="" (same origin as the API).
  widgetDistPath: context('widgetDistPath'),
  // Agent portal: on once the Entra app registration exists (-c portal=on).
  ...(app.node.tryGetContext('portal') === 'on'
    ? { portal: { distPath: context('portalDistPath') } }
    : {}),
  config: PREPROD_CONFIG,
});
// Daily report: needs the portal (its links) and recipients (-c reportRecipients=a@x,b@y).
const reportRecipients: unknown = app.node.tryGetContext('reportRecipients');
const dailyReport =
  app.node.tryGetContext('portal') === 'on' &&
  typeof reportRecipients === 'string' &&
  reportRecipients.trim() !== ''
    ? {
        recipients: reportRecipients,
        lang: app.node.tryGetContext('reportLang') === 'en' ? ('en' as const) : ('nl' as const),
        portalBaseUrl: `https://${service.distribution.distributionDomainName}`,
      }
    : undefined;
new WorkerStack(app, 'TrainmoreChatbot-preprod-worker', {
  envName: 'preprod',
  env,
  foundation,
  imageTag: context('imageTag'),
  config: PREPROD_CONFIG,
  ...(dailyReport ? { dailyReport } : {}),
});
