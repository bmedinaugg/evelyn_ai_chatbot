import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { PREPROD_CONFIG } from '../lib/preprod-config.ts';
import { WorkerStack } from '../lib/worker-stack.ts';

let template: Template;
let withReport: Template;

beforeAll(() => {
  const app = new App();
  const env = { region: 'eu-west-1' };
  const foundation = new FoundationStack(app, 'F', {
    envName: 'preprod',
    emailFrom: 'chat@example.com',
    env,
  });
  // Build every stack before the first synth (Template.fromStack synthesises the app).
  const plain = new WorkerStack(app, 'W', {
    env,
    envName: 'preprod',
    foundation,
    imageTag: 'abc123',
    config: PREPROD_CONFIG,
  });
  const reporting = new WorkerStack(app, 'R', {
    env,
    envName: 'preprod',
    foundation,
    imageTag: 'abc123',
    config: PREPROD_CONFIG,
    dailyReport: {
      recipients: 'support@example.com',
      lang: 'nl',
      portalBaseUrl: 'https://d123.cloudfront.net',
    },
  });
  template = Template.fromStack(plain);
  withReport = Template.fromStack(reporting);
});

function container(t: Template, command: string) {
  return Object.values(t.findResources('AWS::ECS::TaskDefinition'))
    .map((d) => d.Properties.ContainerDefinitions[0])
    .find((c) => c.Command.at(-1) === command);
}

function commands(): Record<string, string[]> {
  const defs = template.findResources('AWS::ECS::TaskDefinition');
  return Object.fromEntries(
    Object.values(defs)
      .filter(
        (d) => d.Properties.Family !== undefined && !String(d.Properties.Family).includes('Ops'),
      )
      .map((d) => {
        const c = d.Properties.ContainerDefinitions[0];
        return [c.Command.at(-1), c.Command];
      }),
  );
}

describe('WorkerStack (preprod)', () => {
  it('has one task per nightly job, all on the same image', () => {
    expect(commands()).toEqual({
      'sync-faq': ['node', 'apps/worker/src/main.ts', 'sync-faq'],
      'sync-ticket-topics': ['node', 'apps/worker/src/main.ts', 'sync-ticket-topics'],
      retention: ['node', 'apps/worker/src/main.ts', 'retention'],
    });
  });

  it('has an ops task for deletion requests: idle, reachable by ECS Exec', () => {
    const ops = Object.values(template.findResources('AWS::ECS::TaskDefinition')).find((d) =>
      String(d.Properties.Family).includes('Ops'),
    );
    expect(ops?.Properties.ContainerDefinitions[0].Command).toEqual(['sleep', '1800']);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['ssmmessages:CreateDataChannel']) }),
        ]),
      },
    });
  });

  it('runs them nightly in Amsterdam time', () => {
    const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((s) => [
      s.Properties.ScheduleExpression,
      s.Properties.ScheduleExpressionTimezone,
    ]);
    expect(schedules).toEqual(
      expect.arrayContaining([
        ['cron(0 2 * * ? *)', 'Europe/Amsterdam'],
        ['cron(15 2 * * ? *)', 'Europe/Amsterdam'],
        ['cron(0 3 * * ? *)', 'Europe/Amsterdam'],
      ]),
    );
    expect(schedules).toHaveLength(3);
  });

  it('schedules the daily report at 07:00 only when recipients are configured', () => {
    expect(container(template, 'daily-report')).toBeUndefined();
    expect(container(withReport, 'daily-report')?.Command).toEqual([
      'node',
      'apps/worker/src/main.ts',
      'daily-report',
    ]);
    const schedules = Object.values(withReport.findResources('AWS::Scheduler::Schedule')).map(
      (s) => s.Properties.ScheduleExpression,
    );
    expect(schedules).toContain('cron(0 7 * * ? *)');
    expect(schedules).toHaveLength(4);
  });

  it('gives only the report task the Claude key, the report settings and SES', () => {
    const report = container(withReport, 'daily-report');
    const env = Object.fromEntries(
      report.Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]),
    );
    expect(env).toMatchObject({
      DAILY_REPORT_RECIPIENTS: 'support@example.com',
      DAILY_REPORT_LANG: 'nl',
      PORTAL_BASE_URL: 'https://d123.cloudfront.net',
      CLAUDE_FAST_MODEL: 'claude-haiku-5-5',
    });
    expect(env.EMAIL_FROM).toBe('chat@example.com');
    expect(report.Secrets.map((s: { Name: string }) => s.Name)).toContain('ANTHROPIC_API_KEY');
    expect(
      container(withReport, 'retention').Secrets.map((s: { Name: string }) => s.Name),
    ).not.toContain('ANTHROPIC_API_KEY');
    const sendStatements = Object.values(withReport.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: { Action: string | string[] }) => [s.Action].flat().includes('ses:SendEmail'));
    expect(sendStatements.length).toBeGreaterThan(0);
    expect(
      Object.values(template.findResources('AWS::IAM::Policy'))
        .flatMap((p) => p.Properties.PolicyDocument.Statement)
        .some((s: { Action: string | string[] }) => [s.Action].flat().includes('ses:SendEmail')),
    ).toBe(false);
  });

  it('nightly jobs get only the secrets they need (no Claude key)', () => {
    const defs = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
    for (const def of defs) {
      const names = def.Properties.ContainerDefinitions[0].Secrets.map(
        (s: { Name: string }) => s.Name,
      );
      expect(names).not.toContain('ANTHROPIC_API_KEY');
      expect(names).toEqual(expect.arrayContaining(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']));
    }
  });

  it('workers accept no inbound traffic', () => {
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 0);
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.absent(),
    });
  });

  it('the scheduler may run only the worker tasks', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const runTask = policies
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: { Action: string | string[] }) => [s.Action].flat().includes('ecs:RunTask'));
    expect(runTask.length).toBeGreaterThan(0);
    for (const statement of runTask) expect(statement.Resource).not.toBe('*');
  });
});
