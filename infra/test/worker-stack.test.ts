import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { FoundationStack } from '../lib/foundation-stack.ts';
import { PREPROD_CONFIG } from '../lib/preprod-config.ts';
import { WorkerStack } from '../lib/worker-stack.ts';

let template: Template;

beforeAll(() => {
  const app = new App();
  const env = { region: 'eu-west-1' };
  const foundation = new FoundationStack(app, 'F', {
    envName: 'preprod',
    emailFrom: 'chat@example.com',
    env,
  });
  template = Template.fromStack(
    new WorkerStack(app, 'W', {
      env,
      envName: 'preprod',
      foundation,
      imageTag: 'abc123',
      config: PREPROD_CONFIG,
    }),
  );
});

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

  it('workers get only the secrets they need (no Claude key)', () => {
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
