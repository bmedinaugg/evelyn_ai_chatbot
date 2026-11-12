import { Stack, type StackProps } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { EnvName } from './foundation-stack.ts';

/** Requests per IP per 5 minutes on /widget/* before WAF blocks (the API has tighter limits). */
const RATE_LIMIT = 500;

/** CloudFront web ACL: AWS managed rule sets plus a per-IP rate limit on the chat API. */
export class WafStack extends Stack {
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: StackProps & { envName: EnvName }) {
    super(scope, id, props);
    if (props.env?.region !== 'us-east-1') {
      throw new Error('A CloudFront web ACL must be created in us-east-1');
    }
    const metric = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: `trainmore-chatbot-${props.envName}-${name}`,
    });
    const managed = (name: string, priority: number): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
      visibilityConfig: metric(name),
    });

    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: metric('acl'),
      rules: [
        managed('AWSManagedRulesAmazonIpReputationList', 0),
        managed('AWSManagedRulesCommonRuleSet', 1),
        managed('AWSManagedRulesKnownBadInputsRuleSet', 2),
        {
          name: 'ChatApiRateLimit',
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: RATE_LIMIT,
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: 'STARTS_WITH',
                  searchString: '/widget/',
                  textTransformations: [{ priority: 0, type: 'NONE' }],
                },
              },
            },
          },
          visibilityConfig: metric('rate-limit'),
        },
      ],
    });
    this.webAclArn = acl.attrArn;
  }
}
