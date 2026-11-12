import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { ServiceStack } from '../lib/service-stack.ts';

const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
let template: Template;

beforeAll(() => {
  // Stand-in for the built widget (apps/widget/dist).
  const dist = mkdtempSync(join(tmpdir(), 'widget-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  writeFileSync(join(dist, 'loader.js'), '');
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), '');

  const app = new App();
  const env = { region: 'eu-west-1' };
  const foundation = new FoundationStack(app, 'F', {
    envName: 'preprod',
    emailFrom: 'chat@example.com',
    env,
  });
  const service = new ServiceStack(app, 'S', {
    env,
    envName: 'preprod',
    foundation,
    imageTag: 'abc123',
    widgetDistPath: dist,
    config: {
      portalOrigins: ['https://www.support.trainmore.com'],
      supportContactUrl: 'https://www.support.trainmore.com/nl/support/tickets/new',
      freshdesk: {
        domain: 'example.freshdesk.com',
        portalUrl: 'https://www.support.trainmore.com',
        portalId: '103000108492',
        faqFolderIds: '1,2',
        topicField: 'ticket_type',
      },
      chatModel: 'claude-sonnet-5-5',
    },
    webAclArn: 'arn:aws:wafv2:us-east-1:111111111111:global/webacl/test/abc',
  });
  template = Template.fromStack(service);
});

function apiContainer() {
  const defs = template.findResources('AWS::ECS::TaskDefinition');
  for (const def of Object.values(defs)) {
    const api = def.Properties.ContainerDefinitions.find((c: { Name: string }) => c.Name === 'api');
    if (api) return { def, api };
  }
  throw new Error('no api container');
}

describe('ServiceStack (preprod)', () => {
  it('the load balancer is internal (only CloudFront reaches it, through a VPC origin)', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
    });
    template.resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
  });

  it('tasks accept traffic only from the load balancer', () => {
    const ingress = template.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: { FromPort: 8080 },
    });
    expect(Object.keys(ingress)).toHaveLength(1);
    expect(Object.values(ingress)[0]?.Properties.SourceSecurityGroupId).toBeDefined();
    expect(JSON.stringify(template.toJSON())).not.toContain('0.0.0.0/0","FromPort":8080');
  });

  it('runs the API on ARM with the mock Magicline as a sidecar', () => {
    const { def, api } = apiContainer();
    expect(def.Properties.RuntimePlatform).toEqual({
      CpuArchitecture: 'ARM64',
      OperatingSystemFamily: 'LINUX',
    });
    const names = def.Properties.ContainerDefinitions.map((c: { Name: string }) => c.Name);
    expect(names).toEqual(expect.arrayContaining(['api', 'mock-magicline']));
    const env = Object.fromEntries(
      api.Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]),
    );
    expect(env).toMatchObject({
      APP_ENV: 'preprod',
      NODE_ENV: 'production',
      TRUST_PROXY_HOPS: '2',
      MAGICLINE_USE_MOCK: 'true',
      MAGICLINE_BASE_URL: 'http://localhost:4010',
      FRESHDESK_PORTAL_ID: '103000108492',
    });
  });

  it('takes secrets from Secrets Manager, never as plain environment values', () => {
    const { api } = apiContainer();
    const secretNames = api.Secrets.map((s: { Name: string }) => s.Name);
    expect(secretNames).toEqual(
      expect.arrayContaining([
        'ANTHROPIC_API_KEY',
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'FRESHDESK_API_KEY',
        'TURNSTILE_SECRET_KEY',
        'OTP_HMAC_SECRET',
      ]),
    );
    const envNames = api.Environment.map((e: { Name: string }) => e.Name);
    for (const name of secretNames) expect(envNames).not.toContain(name);
  });

  it('rolls back a failing deployment', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      },
    });
  });

  it('may send email only from the SES identity', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ses:SendEmail']),
            Resource: Match.not('*'),
          }),
        ]),
      },
    });
  });

  it('serves the widget from a private bucket and never caches the API', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/widget/*', CachePolicyId: CACHING_DISABLED }),
          Match.objectLike({ PathPattern: '/health', CachePolicyId: CACHING_DISABLED }),
        ]),
      }),
    });
  });

  it('lets only the help portal frame the widget, with HSTS', () => {
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: {
            ContentSecurityPolicy: 'frame-ancestors https://www.support.trainmore.com',
            Override: true,
          },
          StrictTransportSecurity: Match.objectLike({ Override: true }),
          ContentTypeOptions: { Override: true },
        }),
      }),
    });
  });

  it('puts the WAF in front of the distribution', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        WebACLId: 'arn:aws:wafv2:us-east-1:111111111111:global/webacl/test/abc',
      }),
    });
  });

  it('outputs the widget URL and the embed snippet, never secrets', () => {
    const outputs = template.toJSON().Outputs ?? {};
    expect(Object.keys(outputs)).toEqual(expect.arrayContaining(['WidgetUrl', 'EmbedSnippet']));
    expect(JSON.stringify(outputs)).not.toMatch(/secretsmanager/);
  });
});
