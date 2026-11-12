import { App } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.ts';

const app = new App();

// Only preprod is deployed until M6 (production go-live).
new FoundationStack(app, 'TrainmoreChatbot-preprod', {
  envName: 'preprod',
  env: { region: 'eu-west-1' },
});
