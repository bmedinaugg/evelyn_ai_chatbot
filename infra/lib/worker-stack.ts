import { Stack, type StackProps, TimeZone } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import type { EnvName, FoundationStack } from './foundation-stack.ts';
import type { ServiceConfig } from './service-stack.ts';

/** Nightly worker jobs (Europe/Amsterdam): FAQ first, then topics, then retention. */
const JOBS = [
  { command: 'sync-faq', hour: 2, minute: 0 },
  { command: 'sync-ticket-topics', hour: 2, minute: 15 },
  { command: 'retention', hour: 3, minute: 0 },
] as const;

export type WorkerStackProps = StackProps & {
  envName: EnvName;
  foundation: FoundationStack;
  imageTag: string;
  config: ServiceConfig;
};

/** Scheduled worker runs (EventBridge Scheduler → ECS RunTask), same image as the API. */
export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkerStackProps) {
    super(scope, id, props);
    const { foundation, config } = props;
    const image = ecs.ContainerImage.fromEcrRepository(foundation.repository, props.imageTag);

    const securityGroup = new ec2.SecurityGroup(this, 'WorkerSecurityGroup', {
      vpc: foundation.vpc,
      description: 'Worker tasks: outbound only',
      allowAllOutbound: true,
    });

    for (const job of JOBS) {
      const taskDefinition = new ecs.FargateTaskDefinition(this, `${job.command}-task`, {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      taskDefinition.addContainer('worker', {
        image,
        essential: true,
        command: ['node', 'apps/worker/src/main.ts', job.command],
        logging: ecs.LogDrivers.awsLogs({
          logGroup: foundation.logGroup,
          streamPrefix: `worker-${job.command}`,
        }),
        environment: {
          NODE_ENV: 'production',
          APP_ENV: props.envName,
          LOG_LEVEL: 'info',
          AWS_REGION: this.region,
          FRESHDESK_DOMAIN: config.freshdesk.domain,
          FRESHDESK_PORTAL_URL: config.freshdesk.portalUrl,
          FRESHDESK_PORTAL_ID: config.freshdesk.portalId,
          FRESHDESK_FAQ_FOLDER_IDS: config.freshdesk.faqFolderIds,
          FRESHDESK_TOPIC_FIELD: config.freshdesk.topicField,
        },
        secrets: {
          SUPABASE_URL: ecs.Secret.fromSecretsManager(foundation.appSecret, 'SUPABASE_URL'),
          SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSecretsManager(
            foundation.appSecret,
            'SUPABASE_SERVICE_ROLE_KEY',
          ),
          FRESHDESK_API_KEY: ecs.Secret.fromSecretsManager(
            foundation.appSecret,
            'FRESHDESK_API_KEY',
          ),
          // dsar-delete (run by hand) hashes emails exactly like the login.
          OTP_HMAC_SECRET: ecs.Secret.fromSecretsManager(foundation.otpHmacSecret),
        },
      });

      new scheduler.Schedule(this, `${job.command}-schedule`, {
        description: `trainmore-chatbot ${props.envName}: ${job.command}`,
        schedule: scheduler.ScheduleExpression.cron({
          hour: String(job.hour),
          minute: String(job.minute),
          timeZone: TimeZone.of('Europe/Amsterdam'),
        }),
        target: new targets.EcsRunFargateTask(foundation.cluster, {
          taskDefinition,
          assignPublicIp: true,
          vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
          securityGroups: [securityGroup],
        }),
      });
    }
  }
}
