import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';

let template: Template;

beforeAll(() => {
  const app = new App();
  template = Template.fromStack(
    new FoundationStack(app, 'T', { envName: 'preprod', emailFrom: 'chat@example.com' }),
  );
});

describe('FoundationStack (preprod)', () => {
  it('has no NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('has public subnets for tasks and isolated (no internet) subnets for the internal ALB', () => {
    const subnets = Object.values(template.findResources('AWS::EC2::Subnet'));
    expect(subnets).toHaveLength(4);
    expect(subnets.filter((s) => s.Properties.MapPublicIpOnLaunch === true)).toHaveLength(2);
  });

  it('does not log interactive ECS sessions (an operator types emails for deletion requests)', () => {
    template.hasResourceProperties('AWS::ECS::Cluster', {
      Configuration: { ExecuteCommandConfiguration: { Logging: 'NONE' } },
    });
  });

  it('encrypts logs with KMS, 30-day retention', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/trainmore-chatbot/preprod',
      RetentionInDays: 30,
      KmsKeyId: Match.anyValue(),
    });
  });

  it('creates the Magicline secrets per env', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'trainmore-chatbot/preprod/magicline-studio-keys',
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'trainmore-chatbot/preprod/magicline-cross-studio-key',
    });
  });

  it('has an app secret whose values are set by hand (none in the template)', () => {
    const secrets = template.findResources('AWS::SecretsManager::Secret', {
      Properties: { Name: 'trainmore-chatbot/preprod/app' },
    });
    expect(Object.keys(secrets)).toHaveLength(1);
    const [app] = Object.values(secrets);
    // Only a random placeholder is generated; the real values are put in by hand.
    expect(app?.Properties.SecretString).toBeUndefined();
  });

  it('generates the OTP HMAC secret (64 characters, nobody types it)', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'trainmore-chatbot/preprod/otp-hmac-secret',
      GenerateSecretString: Match.objectLike({ PasswordLength: 64, ExcludePunctuation: true }),
    });
  });

  it("verifies the sender's whole domain with Easy DKIM (our domains enforce strict DMARC)", () => {
    template.resourceCountIs('AWS::SES::EmailIdentity', 1);
    template.hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: 'example.com',
      DkimAttributes: Match.absent(),
      DkimSigningAttributes: Match.absent(),
    });
  });

  it('outputs the 3 DKIM CNAME records to add to DNS', () => {
    const outputs = template.toJSON().Outputs ?? {};
    for (const n of [1, 2, 3]) expect(outputs).toHaveProperty(`DkimRecord${n}`);
  });

  it('keeps the full sender address for the apps', () => {
    const stack = new FoundationStack(new App(), 'A', {
      envName: 'preprod',
      emailFrom: 'AI@example.org',
    });
    expect(stack.emailFrom).toBe('AI@example.org');
  });

  it('refuses a sender without a domain', () => {
    expect(
      () => new FoundationStack(new App(), 'B', { envName: 'preprod', emailFrom: 'no-domain' }),
    ).toThrow(/emailFrom/);
  });

  it('never outputs secret values', () => {
    const outputs = JSON.stringify(template.toJSON().Outputs ?? {});
    expect(outputs).not.toMatch(/SecretString|resolve:secretsmanager/);
  });

  it('ECR repo has immutable tags and scan on push', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'trainmore-chatbot-preprod',
      ImageTagMutability: 'IMMUTABLE',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('KMS key rotation is on', () => {
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('ECS cluster exists, with a fixed name (the on/off workflow addresses it)', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'trainmore-chatbot-preprod',
    });
  });

  it('tags resources with project and env', () => {
    template.hasResourceProperties('AWS::EC2::VPC', {
      Tags: Match.arrayWith([
        { Key: 'env', Value: 'preprod' },
        { Key: 'project', Value: 'trainmore-chatbot' },
      ]),
    });
  });
});
