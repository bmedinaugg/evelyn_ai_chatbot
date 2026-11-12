import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { EnvName, FoundationStack } from './foundation-stack.ts';

/** Synthetic keys of the mock Magicline (no real customer data in preprod). */
const MOCK_MAGICLINE_KEYS = 'cross:dev-cross,1001:dev-1001,1002:dev-1002';
const API_PORT = 8080;
const MOCK_PORT = 4010;

export type ServiceConfig = {
  /** Origins allowed to frame the widget (the help portal). */
  portalOrigins: string[];
  supportContactUrl: string;
  freshdesk: {
    domain: string;
    portalUrl: string;
    portalId: string;
    faqFolderIds: string;
    topicField: string;
  };
  chatModel: string;
};

export type ServiceStackProps = StackProps & {
  envName: EnvName;
  foundation: FoundationStack;
  /** Image tag in the foundation's ECR repository (the commit SHA). */
  imageTag: string;
  /** Built widget (apps/widget/dist, built with VITE_API_BASE_URL=""). */
  widgetDistPath: string;
  config: ServiceConfig;
  /** WAF web ACL (CLOUDFRONT scope, us-east-1) to attach to the distribution. */
  webAclArn?: string;
};

/**
 * The customer-facing part: one CloudFront distribution serves the widget (S3) at `/` and the
 * API at `/widget/*` and `/health` through a VPC origin to an internal load balancer, so the
 * widget and its API share one origin and nothing but CloudFront is reachable from the internet.
 */
export class ServiceStack extends Stack {
  readonly distribution: cloudfront.Distribution;
  readonly apiTaskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);
    const { foundation, config } = props;
    const { vpc } = foundation;
    const isProd = props.envName === 'prod';
    const publicSubnets = { subnetType: ec2.SubnetType.PUBLIC };

    // Internal: no internet route; CloudFront reaches it through the VPC origin inside the VPC.
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Internal ALB: HTTP from inside the VPC (CloudFront VPC origin) only',
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80));
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: false,
      vpcSubnets: publicSubnets,
      securityGroup: albSecurityGroup,
    });

    // API task: the API plus (preprod) the mock Magicline on localhost.
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    this.apiTaskDefinition = taskDefinition;
    const image = ecs.ContainerImage.fromEcrRepository(foundation.repository, props.imageTag);
    const logging = (prefix: string) =>
      ecs.LogDrivers.awsLogs({ logGroup: foundation.logGroup, streamPrefix: prefix });

    // One VPC origin (one private connection) shared by all API paths.
    const apiOrigin = origins.VpcOrigin.withApplicationLoadBalancer(alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
    });
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `trainmore-chatbot ${props.envName}`,
      ...(props.webAclArn ? { webAclId: props.webAclArn } : {}),
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.widgetBucket(isProd)),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: this.widgetHeaders(config.portalOrigins),
      },
      additionalBehaviors: Object.fromEntries(
        ['/widget/*', '/health'].map((path) => [
          path,
          {
            origin: apiOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            // Origin and Authorization (POST) reach the API; Host is the load balancer's.
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          },
        ]),
      ),
    });
    const widgetOrigin = `https://${this.distribution.distributionDomainName}`;
    this.deployWidget(props.widgetDistPath);

    const api = taskDefinition.addContainer('api', {
      image,
      essential: true,
      command: ['node', 'apps/api/src/main.ts'],
      portMappings: [{ containerPort: API_PORT }],
      logging: logging('api'),
      environment: {
        NODE_ENV: 'production',
        APP_ENV: props.envName,
        LOG_LEVEL: 'info',
        AWS_REGION: this.region,
        API_PORT: String(API_PORT),
        // CloudFront + load balancer in front of the task.
        TRUST_PROXY_HOPS: '2',
        WIDGET_ALLOWED_ORIGINS: widgetOrigin,
        SUPPORT_CONTACT_URL: config.supportContactUrl,
        CLAUDE_CHAT_MODEL: config.chatModel,
        FRESHDESK_DOMAIN: config.freshdesk.domain,
        FRESHDESK_PORTAL_URL: config.freshdesk.portalUrl,
        FRESHDESK_PORTAL_ID: config.freshdesk.portalId,
        FRESHDESK_FAQ_FOLDER_IDS: config.freshdesk.faqFolderIds,
        FRESHDESK_TOPIC_FIELD: config.freshdesk.topicField,
        EMAIL_FROM: foundation.emailIdentity.emailIdentityName,
        MAGICLINE_USE_MOCK: 'true',
        MAGICLINE_BASE_URL: `http://localhost:${MOCK_PORT}`,
        MOCK_MAGICLINE_KEYS,
      },
      secrets: {
        ...Object.fromEntries(
          [
            'ANTHROPIC_API_KEY',
            'SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'FRESHDESK_API_KEY',
            'TURNSTILE_SECRET_KEY',
          ].map((name) => [name, ecs.Secret.fromSecretsManager(foundation.appSecret, name)]),
        ),
        OTP_HMAC_SECRET: ecs.Secret.fromSecretsManager(foundation.otpHmacSecret),
      },
    });
    const mock = taskDefinition.addContainer('mock-magicline', {
      image,
      essential: true,
      command: ['node', 'apps/mock-magicline/src/main.ts'],
      logging: logging('mock-magicline'),
      environment: {
        NODE_ENV: 'production',
        PORT: String(MOCK_PORT),
        MOCK_MAGICLINE_KEYS,
      },
    });
    api.addContainerDependencies({
      container: mock,
      condition: ecs.ContainerDependencyCondition.START,
    });
    foundation.emailIdentity.grantSendEmail(taskDefinition.taskRole);

    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'API tasks: traffic from the internal ALB only',
      allowAllOutbound: true,
    });
    taskSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(API_PORT));

    const service = new ecs.FargateService(this, 'ApiService', {
      cluster: foundation.cluster,
      taskDefinition,
      desiredCount: 1,
      // No NAT: tasks get a public IP for outbound calls; inbound is closed by the security group.
      assignPublicIp: true,
      vpcSubnets: publicSubnets,
      securityGroups: [taskSecurityGroup],
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    alb.addListener('Http', { port: 80, open: false }).addTargets('Api', {
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: 'api', containerPort: API_PORT })],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(15) },
      deregistrationDelay: Duration.seconds(30),
    });

    new CfnOutput(this, 'WidgetUrl', { value: `${widgetOrigin}/` });
    new CfnOutput(this, 'EmbedSnippet', {
      description: 'Add to the Freshdesk help portal layout',
      value: `<script src="${widgetOrigin}/loader.js" data-widget-url="${widgetOrigin}/" async></script>`,
    });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }

  private bucket?: s3.Bucket;

  private widgetBucket(isProd: boolean): s3.Bucket {
    this.bucket ??= new s3.Bucket(this, 'WidgetBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });
    return this.bucket;
  }

  /** Uploads the built widget: hashed assets cached for a year, the rest for a minute. */
  private deployWidget(distPath: string): void {
    const bucket = this.widgetBucket(false);
    new s3deploy.BucketDeployment(this, 'WidgetAssets', {
      sources: [s3deploy.Source.asset(distPath)],
      destinationBucket: bucket,
      include: ['assets/*'],
      exclude: ['*'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
    });
    new s3deploy.BucketDeployment(this, 'WidgetEntry', {
      sources: [s3deploy.Source.asset(distPath)],
      destinationBucket: bucket,
      exclude: ['assets/*'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=60')],
      distribution: this.distribution,
      distributionPaths: ['/index.html', '/loader.js', '/loader.css', '/'],
    });
  }

  /** Only the help portal may frame the widget; HSTS, nosniff, strict referrer. */
  private widgetHeaders(portalOrigins: string[]): cloudfront.ResponseHeadersPolicy {
    return new cloudfront.ResponseHeadersPolicy(this, 'WidgetHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: `frame-ancestors ${portalOrigins.join(' ')}`,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });
  }
}
