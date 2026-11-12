import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { WafStack } from '../lib/waf-stack.ts';

let template: Template;

beforeAll(() => {
  const app = new App();
  template = Template.fromStack(
    new WafStack(app, 'W', { envName: 'preprod', env: { region: 'us-east-1' } }),
  );
});

describe('WafStack', () => {
  it('is a CloudFront web ACL that allows by default', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      DefaultAction: { Allow: {} },
    });
  });

  it('uses the AWS managed rule sets', () => {
    const [acl] = Object.values(template.findResources('AWS::WAFv2::WebACL'));
    const managed = acl?.Properties.Rules.flatMap(
      (r: { Statement: { ManagedRuleGroupStatement?: { Name: string } } }) =>
        r.Statement.ManagedRuleGroupStatement ? [r.Statement.ManagedRuleGroupStatement.Name] : [],
    );
    expect(managed).toEqual([
      'AWSManagedRulesAmazonIpReputationList',
      'AWSManagedRulesCommonRuleSet',
      'AWSManagedRulesKnownBadInputsRuleSet',
    ]);
  });

  it('rate-limits each IP on the chat API', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        Match.objectLike({
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: Match.objectLike({
              AggregateKeyType: 'IP',
              Limit: 500,
              ScopeDownStatement: Match.objectLike({
                ByteMatchStatement: Match.objectLike({
                  SearchString: '/widget/',
                  PositionalConstraint: 'STARTS_WITH',
                }),
              }),
            }),
          },
        }),
      ]),
    });
  });

  it('must live in us-east-1 (CloudFront scope)', () => {
    const app = new App();
    expect(
      () => new WafStack(app, 'X', { envName: 'preprod', env: { region: 'eu-west-1' } }),
    ).toThrow(/us-east-1/);
  });
});
