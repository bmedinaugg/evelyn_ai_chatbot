import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { PREPROD_CONFIG } from '../lib/preprod-config.ts';
import { ServiceStack } from '../lib/service-stack.ts';

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
new ServiceStack(app, 'TrainmoreChatbot-preprod-service', {
  envName: 'preprod',
  env,
  foundation,
  imageTag: context('imageTag'),
  // Built by the deploy workflow with VITE_API_BASE_URL="" (same origin as the API).
  widgetDistPath: context('widgetDistPath'),
  config: PREPROD_CONFIG,
});
