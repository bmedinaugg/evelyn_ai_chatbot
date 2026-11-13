import { CfnOutput, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';

export type EnvName = 'preprod' | 'prod';

export type FoundationStackProps = StackProps & {
  envName: EnvName;
  /** Sender of login-code emails (preprod: one verified address, SES sandbox). */
  emailFrom: string;
};

/** Shared, long-lived resources per environment. Services are added in later milestones. */
export class FoundationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly repository: ecr.Repository;
  readonly logGroup: logs.LogGroup;
  readonly magiclineStudioKeys: secretsmanager.Secret;
  readonly magiclineCrossStudioKey: secretsmanager.Secret;
  /** JSON: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRESHDESK_API_KEY, TURNSTILE_SECRET_KEY. */
  readonly appSecret: secretsmanager.Secret;
  readonly otpHmacSecret: secretsmanager.Secret;
  /** SES identity for the sender's domain (Easy DKIM). */
  readonly emailIdentity: ses.EmailIdentity;
  /** The sender address the apps put in From. */
  readonly emailFrom: string;
  /** JSON: ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET (agent portal, set by hand). */
  readonly portalSecret: secretsmanager.Secret;
  readonly portalSessionSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const env = props.envName;
    const prefix = `trainmore-chatbot/${env}`;
    const retain = env === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    Tags.of(this).add('project', 'trainmore-chatbot');
    Tags.of(this).add('env', env);

    // Tasks run in public subnets with a public IP behind security groups instead of a NAT gateway
    // (~$35/month). Isolated subnets (no internet route, no cost) hold the internal load balancer.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      // Fixed name: the preprod on/off workflow addresses the API service by cluster and name.
      clusterName: `trainmore-chatbot-${env}`,
      vpc: this.vpc,
      // Interactive sessions are not logged: operators type email addresses for deletion requests.
      executeCommandConfiguration: { logging: ecs.ExecuteCommandLogging.NONE },
    });

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `trainmore-chatbot-${env}`,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: retain,
      emptyOnDelete: env !== 'prod',
    });

    const logKey = new kms.Key(this, 'LogKey', {
      description: `${prefix} log encryption`,
      enableKeyRotation: true,
      removalPolicy: retain,
    });
    logKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
        actions: [
          'kms:Encrypt*',
          'kms:Decrypt*',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:Describe*',
        ],
        resources: ['*'],
      }),
    );

    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/trainmore-chatbot/${env}`,
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: logKey,
      removalPolicy: retain,
    });

    // Values are set manually (console/CLI), never in code.
    this.magiclineStudioKeys = new secretsmanager.Secret(this, 'MagiclineStudioKeys', {
      secretName: `${prefix}/magicline-studio-keys`,
      description: 'JSON map of studioId -> Magicline API key',
      removalPolicy: retain,
    });
    this.magiclineCrossStudioKey = new secretsmanager.Secret(this, 'MagiclineCrossStudioKey', {
      secretName: `${prefix}/magicline-cross-studio-key`,
      description: 'Magicline cross-studio API key',
      removalPolicy: retain,
    });

    // Set by hand after the first deploy (docs/DEPLOY.md); the template never holds the values.
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: `${prefix}/app`,
      description:
        'JSON: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FRESHDESK_API_KEY, TURNSTILE_SECRET_KEY',
      removalPolicy: retain,
    });
    // Generated once; hashes of login codes and emails depend on it, so it is never rotated casually.
    this.otpHmacSecret = new secretsmanager.Secret(this, 'OtpHmacSecret', {
      secretName: `${prefix}/otp-hmac-secret`,
      description: 'Pepper for login-code and email hashes',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: retain,
    });

    // Agent portal (only used once the portal is switched on, docs/DEPLOY.md).
    this.portalSecret = new secretsmanager.Secret(this, 'PortalSecret', {
      secretName: `${prefix}/portal`,
      description: 'JSON: ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET',
      removalPolicy: retain,
    });
    this.portalSessionSecret = new secretsmanager.Secret(this, 'PortalSessionSecret', {
      secretName: `${prefix}/portal-session-secret`,
      description: 'Signs the short-lived portal login cookie',
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: retain,
    });

    // Our domains publish DMARC p=reject with strict alignment, so mail only passes when SES signs
    // it as the sender's own domain: verify the whole domain with Easy DKIM (3 CNAME records in
    // DNS, see the outputs) rather than the single address.
    const domain = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/.exec(props.emailFrom)?.[1];
    if (!domain) throw new Error('emailFrom must be an email address (name@domain)');
    this.emailFrom = props.emailFrom;
    this.emailIdentity = new ses.EmailIdentity(this, 'EmailIdentity', {
      identity: ses.Identity.domain(domain),
    });
    this.emailIdentity.dkimRecords.forEach((record, i) => {
      new CfnOutput(this, `DkimRecord${i + 1}`, {
        description: `DNS: CNAME record ${i + 1} of 3 for ${domain} (SES Easy DKIM)`,
        value: `${record.name} CNAME ${record.value}`,
      });
    });
  }
}
