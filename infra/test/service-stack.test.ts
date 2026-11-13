import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { ServiceStack } from '../lib/service-stack.ts';

const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const PREPROD_TEST_CONFIG = {
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
  fastModel: 'claude-haiku-5-5',
};
let template: Template;
let portalTemplate: Template;

beforeAll(() => {
  // Stand-in for the built widget (apps/widget/dist).
  const dist = mkdtempSync(join(tmpdir(), 'widget-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html>');
  writeFileSync(join(dist, 'loader.js'), '');
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), '');
  const portalDist = mkdtempSync(join(tmpdir(), 'portal-dist-'));
  writeFileSync(join(portalDist, 'index.html'), '<!doctype html>');

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
    config: PREPROD_TEST_CONFIG,
    webAclArn: 'arn:aws:wafv2:us-east-1:111111111111:global/webacl/test/abc',
    onDemand: { stopHour: 20 },
  });
  template = Template.fromStack(service);

  // Same stacks with the portal switched on.
  const portalApp = new App();
  const portalFoundation = new FoundationStack(portalApp, 'F', {
    envName: 'preprod',
    emailFrom: 'chat@example.com',
    env,
  });
  portalTemplate = Template.fromStack(
    new ServiceStack(portalApp, 'S', {
      env,
      envName: 'preprod',
      foundation: portalFoundation,
      imageTag: 'abc123',
      widgetDistPath: dist,
      portal: { distPath: portalDist },
      config: PREPROD_TEST_CONFIG,
    }),
  );
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

  it('the load balancer admits CloudFront (origin-facing prefix list), not the VPC range', () => {
    const rules = Object.values(
      template.findResources('AWS::EC2::SecurityGroupIngress', { Properties: { FromPort: 80 } }),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.Properties.SourcePrefixListId).toBeDefined();
    expect(rules[0]?.Properties.CidrIp).toBeUndefined();
    const [sg] = Object.values(
      template.findResources('AWS::EC2::SecurityGroup', {
        Properties: { GroupDescription: Match.stringLikeRegexp('Internal ALB') },
      }),
    );
    expect(sg?.Properties.SecurityGroupIngress).toBeUndefined();
    expect(JSON.stringify(template.toJSON())).toContain(
      'com.amazonaws.global.cloudfront.origin-facing',
    );
  });

  it('the load balancer sits in the private (isolated) subnets', () => {
    const [alb] = Object.values(
      template.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer'),
    );
    expect(JSON.stringify(alb?.Properties.Subnets)).toMatch(/Isolated/i);
    expect(JSON.stringify(alb?.Properties.Subnets)).not.toMatch(/publicSubnet/i);
  });

  it('waits up to 60 s for a chat answer (tool turns take longer than the 30 s default)', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            VpcOriginConfig: Match.objectLike({ OriginReadTimeout: 60 }),
          }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      LoadBalancerAttributes: Match.arrayWith([
        { Key: 'idle_timeout.timeout_seconds', Value: '75' },
      ]),
    });
  });

  it('preprod (SES sandbox) may also send to verified recipient identities of the account', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendEmail',
            Resource: Match.objectLike({
              'Fn::Join': Match.arrayWith([Match.arrayWith([':identity/*'])]),
            }),
          }),
        ]),
      },
    });
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
      CLAUDE_FAST_MODEL: 'claude-haiku-5-5',
      // The sender address, not the SES (domain) identity.
      EMAIL_FROM: 'chat@example.com',
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

  it('has a fixed service name for the on/off workflow', () => {
    template.hasResourceProperties('AWS::ECS::Service', { ServiceName: 'api' });
  });

  it('runs on demand: no fixed task count, so a deploy keeps the service on or off', () => {
    template.hasResourceProperties('AWS::ECS::Service', { DesiredCount: Match.absent() });
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      ScalableDimension: 'ecs:service:DesiredCount',
      MinCapacity: 0,
      MaxCapacity: 1,
    });
  });

  it('switches the API off every evening at 20:00 Amsterdam time', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      ScheduledActions: [
        Match.objectLike({
          Schedule: 'cron(0 20 * * ? *)',
          Timezone: 'Europe/Amsterdam',
          ScalableTargetAction: { MinCapacity: 0, MaxCapacity: 0 },
        }),
      ],
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

  it('leaves the portal out until it is switched on', () => {
    const { api } = apiContainer();
    const secretNames = api.Secrets.map((s: { Name: string }) => s.Name);
    expect(secretNames).not.toContain('ENTRA_CLIENT_SECRET');
    expect(JSON.stringify(template.toJSON())).not.toContain('/portal/api/*');
  });
});

describe('ServiceStack without onDemand (always on)', () => {
  it('keeps one task running and never scales to zero', () => {
    portalTemplate.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
    portalTemplate.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});

describe('ServiceStack with the agent portal', () => {
  function portalApi() {
    for (const def of Object.values(portalTemplate.findResources('AWS::ECS::TaskDefinition'))) {
      const api = def.Properties.ContainerDefinitions.find(
        (c: { Name: string }) => c.Name === 'api',
      );
      if (api) return api;
    }
    throw new Error('no api container');
  }

  it('routes the portal API and sign-in to the API, uncached, before the portal files', () => {
    const [dist] = Object.values(portalTemplate.findResources('AWS::CloudFront::Distribution'));
    const behaviors = dist?.Properties.DistributionConfig.CacheBehaviors as {
      PathPattern: string;
      CachePolicyId: string;
    }[];
    const order = behaviors.map((b) => b.PathPattern);
    expect(order.indexOf('/portal/api/*')).toBeLessThan(order.indexOf('/portal/*'));
    expect(order.indexOf('/portal/auth/*')).toBeLessThan(order.indexOf('/portal/*'));
    for (const path of ['/portal/api/*', '/portal/auth/*']) {
      expect(behaviors.find((b) => b.PathPattern === path)?.CachePolicyId).toBe(CACHING_DISABLED);
    }
  });

  it('never lets the portal be framed', () => {
    portalTemplate.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: {
            ContentSecurityPolicy: "frame-ancestors 'none'",
            Override: true,
          },
        }),
      }),
    });
  });

  it('serves /portal/ as its index page (CloudFront function)', () => {
    portalTemplate.resourceCountIs('AWS::CloudFront::Function', 1);
  });

  it('gives the API the Entra settings from Secrets Manager and its own address', () => {
    const api = portalApi();
    const secretNames = api.Secrets.map((s: { Name: string }) => s.Name);
    expect(secretNames).toEqual(
      expect.arrayContaining([
        'ENTRA_TENANT_ID',
        'ENTRA_CLIENT_ID',
        'ENTRA_CLIENT_SECRET',
        'PORTAL_SESSION_SECRET',
      ]),
    );
    expect(api.Environment.map((e: { Name: string }) => e.Name)).toContain('PORTAL_BASE_URL');
  });
});
