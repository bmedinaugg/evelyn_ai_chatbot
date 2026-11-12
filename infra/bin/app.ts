import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.ts';

const app = new App();

// Only preprod is deployed until M6 (production go-live).
/** Required context value (`cdk deploy -c key=value` or cdk.json); fails synth when missing. */
function context(key: string): string {
  const value: unknown = app.node.tryGetContext(key);
  if (typeof value !== 'string' || value === '') throw new Error(`Missing CDK context: ${key}`);
  return value;
}

new FoundationStack(app, 'TrainmoreChatbot-preprod', {
  envName: 'preprod',
  env: { region: 'eu-west-1' },
  emailFrom: context('emailFrom'),
});
