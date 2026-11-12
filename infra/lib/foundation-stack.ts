import { RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export type EnvName = 'preprod' | 'prod';

export type FoundationStackProps = StackProps & { envName: EnvName };

/** Shared, long-lived resources per environment. Services are added in later milestones. */
export class FoundationStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly repository: ecr.Repository;
  readonly logGroup: logs.LogGroup;
  readonly magiclineStudioKeys: secretsmanager.Secret;
  readonly magiclineCrossStudioKey: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);
    const env = props.envName;
    const prefix = `trainmore-chatbot/${env}`;
    const retain = env === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    Tags.of(this).add('project', 'trainmore-chatbot');
    Tags.of(this).add('env', env);

    // Public subnets only: tasks get a public IP behind security groups instead of a NAT gateway (~$35/month).
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc: this.vpc });

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
  }
}
