import { Stack, type StackProps, TimeZone } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
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

/** Daily report to support staff, about the previous Amsterdam day (M5). */
const REPORT_JOB = { command: 'daily-report', hour: 7, minute: 0 } as const;

export type WorkerStackProps = StackProps & {
  envName: EnvName;
  foundation: FoundationStack;
  imageTag: string;
  config: ServiceConfig;
  /** Daily report email; not scheduled without recipients. */
  dailyReport?: { recipients: string; lang: 'nl' | 'en'; portalBaseUrl: string };
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

    const workerTask = (
      id: string,
      command: string[],
      streamPrefix: string,
      extra: { environment?: Record<string, string>; secrets?: Record<string, ecs.Secret> } = {},
    ) => {
      const taskDefinition = new ecs.FargateTaskDefinition(this, id, {
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
        command,
        logging: ecs.LogDrivers.awsLogs({ logGroup: foundation.logGroup, streamPrefix }),
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
          ...extra.environment,
        },
        secrets: {
          ...extra.secrets,
          SUPABASE_URL: ecs.Secret.fromSecretsManager(foundation.appSecret, 'SUPABASE_URL'),
          SUPABASE_SERVICE_ROLE_KEY: ecs.Secret.fromSecretsManager(
            foundation.appSecret,
            'SUPABASE_SERVICE_ROLE_KEY',
          ),
          FRESHDESK_API_KEY: ecs.Secret.fromSecretsManager(
            foundation.appSecret,
            'FRESHDESK_API_KEY',
          ),
          // dsar-delete hashes emails exactly like the login.
          OTP_HMAC_SECRET: ecs.Secret.fromSecretsManager(foundation.otpHmacSecret),
        },
      });
      return taskDefinition;
    };

    // Ops task for deletion requests: idles for 30 minutes so an operator can open an ECS Exec
    // session and run `dsar-delete` interactively (docs/DEPLOY.md). Sessions are not logged.
    const ops = workerTask('Ops', ['sleep', '1800'], 'worker-ops');
    ops.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        // ECS Exec (SSM Session Manager channels); AWS does not support narrower resources here.
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }),
    );

    const schedule = (
      job: { command: string; hour: number; minute: number },
      taskDefinition: ecs.FargateTaskDefinition,
    ) =>
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

    for (const job of JOBS) {
      schedule(
        job,
        workerTask(
          `${job.command}-task`,
          ['node', 'apps/worker/src/main.ts', job.command],
          `worker-${job.command}`,
        ),
      );
    }

    if (props.dailyReport) {
      // The only worker that calls Claude (clustering) and sends email.
      const report = workerTask(
        `${REPORT_JOB.command}-task`,
        ['node', 'apps/worker/src/main.ts', REPORT_JOB.command],
        `worker-${REPORT_JOB.command}`,
        {
          environment: {
            CLAUDE_FAST_MODEL: config.fastModel,
            EMAIL_FROM: foundation.emailIdentity.emailIdentityName,
            DAILY_REPORT_RECIPIENTS: props.dailyReport.recipients,
            DAILY_REPORT_LANG: props.dailyReport.lang,
            PORTAL_BASE_URL: props.dailyReport.portalBaseUrl,
          },
          secrets: {
            ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(
              foundation.appSecret,
              'ANTHROPIC_API_KEY',
            ),
          },
        },
      );
      foundation.emailIdentity.grantSendEmail(report.taskRole);
      if (props.envName !== 'prod') {
        // SES sandbox (preprod) also checks permission on each verified recipient identity.
        report.taskRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            actions: ['ses:SendEmail'],
            resources: [
              this.formatArn({ service: 'ses', resource: 'identity', resourceName: '*' }),
            ],
          }),
        );
      }
      schedule(REPORT_JOB, report);
    }
  }
}
