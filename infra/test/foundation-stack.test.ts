import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';

let template: Template;

beforeAll(() => {
  const app = new App();
  template = Template.fromStack(new FoundationStack(app, 'T', { envName: 'preprod' }));
});

describe('FoundationStack (preprod)', () => {
  it('has no NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('has only public subnets', () => {
    const subnets = template.findResources('AWS::EC2::Subnet');
    expect(Object.keys(subnets)).toHaveLength(2);
    for (const subnet of Object.values(subnets)) {
      expect(subnet.Properties.MapPublicIpOnLaunch).toBe(true);
    }
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

  it('ECS cluster exists', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
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
