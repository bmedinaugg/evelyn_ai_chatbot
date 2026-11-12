import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { PREPROD_CONFIG } from '../lib/preprod-config.ts';
import { ServiceStack } from '../lib/service-stack.ts';
import { WafStack } from '../lib/waf-stack.ts';

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
// CloudFront web ACLs live in us-east-1; the ARN is passed across regions.
const waf = new WafStack(app, 'TrainmoreChatbot-preprod-waf', {
  envName: 'preprod',
  env: { region: 'us-east-1' },
  crossRegionReferences: true,
});
new ServiceStack(app, 'TrainmoreChatbot-preprod-service', {
  envName: 'preprod',
  env,
  crossRegionReferences: true,
  webAclArn: waf.webAclArn,
  foundation,
  imageTag: context('imageTag'),
  // Built by the deploy workflow with VITE_API_BASE_URL="" (same origin as the API).
  widgetDistPath: context('widgetDistPath'),
  config: PREPROD_CONFIG,
});
