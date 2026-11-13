# Deploying preprod

Preprod is the only deployed environment until M6. Deploys run from GitHub Actions
(**Actions → Deploy preprod → Run workflow**), with no AWS keys stored anywhere. What gets
deployed:

| Stack | Region | Contents |
|---|---|---|
| `TrainmoreChatbot-preprod` | eu-west-1 | network, ECS cluster, ECR, encrypted logs, secrets, SES sender domain (DKIM) |
| `TrainmoreChatbot-preprod-service` | eu-west-1 | CloudFront (widget + API on one domain), S3, internal ALB, API on Fargate with mock Magicline (on demand, see below) |
| `TrainmoreChatbot-preprod-worker` | eu-west-1 | nightly FAQ sync (02:00), topic sync (02:15), retention (03:00), Amsterdam time |
| `TrainmoreChatbot-preprod-waf` | us-east-1 | optional (`PREPROD_WAF=true`): WAF for CloudFront (managed rules, per-IP rate limit) |

Preprod always uses the **mock Magicline** with synthetic profiles. Real Magicline keys come with
M6. To keep costs low for light testing, the **API runs only when switched on** and switches off
every day at 20:00, and there is **no WAF** by default. Expected cost is about $25/month, excluding
Claude usage and Supabase (see ARCHITECTURE §2).

## One-time setup

### 1. AWS account
- Use a dedicated account for the chatbot if possible (production will get its own later).
- Bootstrap CDK in eu-west-1 (also in us-east-1 only if you turn the WAF on, which lives there).
  AWS CloudShell (the `>_` icon in the console) has everything needed:
  ```sh
  npx --yes aws-cdk@2.1148.0 bootstrap aws://<ACCOUNT_ID>/eu-west-1
  ```

### 2. GitHub OIDC deploy role
1. IAM → Identity providers → add `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. Create the role `trainmore-chatbot-preprod-deploy` with this trust policy (only the `preprod`
   environment of this repository can assume it):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": {
           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
           "token.actions.githubusercontent.com:sub": "repo:bmedinaugg/evelyn_ai_chatbot:environment:preprod"
         }
       }
     }]
   }
   ```
3. Give it this permissions policy. It may use the CDK bootstrap roles, push the image, and switch
   the preprod API on and off:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "sts:AssumeRole", "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-*" },
       { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
       {
         "Effect": "Allow",
         "Action": ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages"],
         "Resource": "arn:aws:ecr:eu-west-1:<ACCOUNT_ID>:repository/trainmore-chatbot-preprod"
       },
       { "Effect": "Allow", "Action": "application-autoscaling:RegisterScalableTarget", "Resource": "*" },
       {
         "Effect": "Allow",
         "Action": ["ecs:DescribeServices", "ecs:UpdateService"],
         "Resource": "arn:aws:ecs:eu-west-1:<ACCOUNT_ID>:service/trainmore-chatbot-preprod/api"
       }
     ]
   }
   ```

### 3. Supabase preprod project
- Create a separate project for preprod in an EU region, ideally `eu-west-1` (Ireland). Never use
  the production project.
- Note three values:
  - the project URL
  - the **service role key** (it goes to Secrets Manager only and never reaches the widget)
  - the database connection string (used for migrations)

### 4. Cloudflare Turnstile
- Create a widget and copy its **site key** (public) and **secret key**.
- The hostname is only known after the first deploy (`dxxxx.cloudfront.net`). Until then, use
  Cloudflare's test keys (site key `1x00000000000000000000AA`, secret
  `1x0000000000000000000000000000000AA`), then switch.

### 5. GitHub repository
Settings → Environments → **preprod**. A required reviewer is optional: it also applies to every
"Preprod on/off" run, so each switch-on then waits for an approval. Then add:

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_DEPLOY_ROLE_ARN` | ARN of the role from step 2 |
| Variable | `EMAIL_FROM` | sender of login codes and the daily report, now `AI@urbangymgroup.com` (its whole domain is verified in SES, see below) |
| Variable | `TURNSTILE_SITE_KEY` | Turnstile site key (public) |
| Variable | `PRIVACY_URL` | privacy statement URL shown in the consent notice |
| Variable | `DAILY_REPORT_RECIPIENTS` | optional: comma-separated support addresses (no spaces, at most 50) for the 07:00 daily report; the report is only scheduled with the portal on and this set |
| Variable | `DAILY_REPORT_LANG` | optional: `nl` (default) or `en` |
| Variable | `PREPROD_WAF` | optional: `true` adds the WAF (about $10/month; also bootstrap us-east-1) |
| Secret | `SUPABASE_DB_URL` | Supabase database connection string (migrations) |

## First deploy (three steps)

1. **Foundation only.** Run the workflow with **foundation_only** ticked. This creates ECR, the
   secrets and the SES identity. The service is not created yet, because it cannot start
   without its secrets.
2. **Fill in the secrets** with the AWS CLI from a trusted machine:
   - Write a temporary file `app.json` and delete it right after.
   - Never commit it and never paste it in chat.
   ```sh
   cat > app.json <<'JSON'
   {"ANTHROPIC_API_KEY":"…","SUPABASE_URL":"https://….supabase.co","SUPABASE_SERVICE_ROLE_KEY":"…",
    "FRESHDESK_API_KEY":"…","TURNSTILE_SECRET_KEY":"…"}
   JSON
   aws secretsmanager put-secret-value --region eu-west-1 \
     --secret-id trainmore-chatbot/preprod/app --secret-string file://app.json && rm app.json
   ```
   - `trainmore-chatbot/preprod/otp-hmac-secret` is already generated. Never change it: login
     codes and deletion requests depend on it.
   - **SES sender domain (DKIM):** our domains (urbangymgroup.com, trainmore.nl, trainmore.com)
     publish DMARC `p=reject` with strict alignment, so receivers reject mail that is not signed
     by the sender's own domain. The stack therefore verifies the **domain** of `EMAIL_FROM` with
     Easy DKIM. Its outputs `DkimRecord1`–`3` (CloudFormation → `TrainmoreChatbot-preprod` →
     Outputs) are three CNAME records: whoever manages that domain's DNS adds them. SES shows the
     domain as verified within about an hour after that; until then no email can be sent.
   - **SES production access:** a new account is in the SES sandbox and only delivers to verified
     addresses (any address of the verified domain counts). For customers, request production
     access: SES → Account dashboard → **Request production access** (transactional; login codes
     and an internal daily report; bounces and complaints are handled by SES suppression). AWS
     usually answers within a day. The preprod task role may send to any verified identity of the
     account, as the sandbox requires; prod sends from its identity only.
3. **Full deploy.** Run the workflow again without the tick. It does the following:
   1. runs the tests
   2. builds the widget
   3. applies the database migrations
   4. builds and pushes the ARM image (tagged with the commit)
   5. deploys the service and worker schedules (and the WAF if `PREPROD_WAF` is `true`)

   If the service cannot become healthy, the deployment rolls back by itself.

The stack outputs (CloudFormation → `TrainmoreChatbot-preprod-service` → Outputs) give:
- `WidgetUrl`: `https://dxxxx.cloudfront.net/`
- `EmbedSnippet`: the `<script>` tag for the help portal

## After the first deploy
- **Turnstile:** add `dxxxx.cloudfront.net` to the Turnstile widget's hostnames. Put the real
  keys in the variable and the app secret, then deploy again.
- **FAQ and topics:** they sync at night. To fill them right away, use ECS → cluster → Run new
  task → the `sync-faq` (then `sync-ticket-topics`) task definition, Fargate, public subnets,
  the worker security group, public IP on.
- **Try it without touching the live portal:**
  ```sh
  cd apps/widget/demo && python3 -m http.server 8090 --bind 127.0.0.1
  open "http://127.0.0.1:8090/nl/support/home/?widget=https://dxxxx.cloudfront.net/"
  ```
  Only the help portal and this local demo page may frame the preprod widget.
- **Embed on the help portal** (Freshdesk → Admin → Portals → Customize → Layout) only after
  preprod has been signed off. Until production (M6) it would show the preprod bot to customers.

## Agent portal (Microsoft Entra ID)
The portal (`https://dxxxx.cloudfront.net/portal/`) stays off until these steps are done.

1. **App registration** (Entra admin centre → App registrations → New):
   - Name: `TrainMore chatbot portal (preprod)`
   - Accounts: **this organisational directory only** (single tenant)
   - Redirect URI, platform **Web**: `https://dxxxx.cloudfront.net/portal/auth/callback`
     (for local development also `http://localhost:5174/portal/auth/callback`)
2. **App roles** (App registration → App roles → Create), each for "Users/Groups":

   | Display name | Value |
   |---|---|
   | Support agent | `agent` |
   | Approver | `approver` |
   | Admin | `admin` |
3. **Assign groups:** Enterprise applications → the app → Users and groups.
   - Assign each Entra group to a role (for example: support team → `agent`, team leads →
     `approver`, chatbot owners → `admin`).
   - Turn on **Assignment required**, so people without a role cannot sign in.
4. **Client secret:** Certificates & secrets → New client secret (12 months). Put it with the
   tenant and client ids in Secrets Manager. Never commit it or paste it in chat.
   ```sh
   cat > portal.json <<'JSON'
   {"ENTRA_TENANT_ID":"<directory (tenant) id>","ENTRA_CLIENT_ID":"<application (client) id>","ENTRA_CLIENT_SECRET":"…"}
   JSON
   aws secretsmanager put-secret-value --region eu-west-1 \
     --secret-id trainmore-chatbot/preprod/portal --secret-string file://portal.json && rm portal.json
   ```
   The session-signing secret (`…/portal-session-secret`) is already generated.
5. **Switch it on:** set the GitHub variable `PORTAL_ENABLED` to `true` and run **Deploy preprod**.
6. **Renew the client secret** before it expires: put the new value in the same secret, then
   redeploy.

**Locally:** fill `ENTRA_*`, `PORTAL_BASE_URL=http://localhost:5174` and `PORTAL_SESSION_SECRET` in
`.env`, start the API, then run `pnpm --filter @trainmore/portal dev` and open
http://localhost:5174/portal/. The dev server forwards `/portal/api` and `/portal/auth` to the API.

## Switching preprod on and off
The API task runs only when needed (about $14/month saved). The widget files, the database and the
nightly jobs are not affected.
- **On:** Actions → **Preprod on/off** → `on`. Ready after about 2 minutes (the run waits for it).
- **Off:** the same workflow with `off`, or nothing: it switches off by itself every day at
  **20:00 Amsterdam time**.
- **While off** the widget opens, but sending a message shows its error notice; the agent portal cannot
  sign in.
- **Deploys keep the current state:** deploying while off leaves it off (switch it on afterwards to
  try the new version). The very first deploy starts it.

## Routine deploys
Run **Deploy preprod**. Images are tagged with the commit and are immutable, so redeploying the
same commit reuses its image.

## Daily report
- **Schedule:** 07:00 Europe/Amsterdam, about the previous day. The report task is the only worker
  with the Claude key (topic grouping) and SES permission.
- **SES sandbox (preprod):** until production access is granted, every recipient outside the sender's verified domain must be verified in SES first. Each person
  clicks the link in the verification email.
- **Send again** (for example after a failed run): run the report task once with the command
  override `node apps/worker/src/main.ts daily-report --resend`. That reports yesterday again.
  Other days can only be re-sent locally (`--day`).
- **Locally:** set `DAILY_REPORT_RECIPIENTS` and `PORTAL_BASE_URL`, then run
  `node apps/worker/src/main.ts daily-report --day 2026-11-12 --resend` with `APP_ENV=local`. The
  local outbox prints the email instead of sending it.

## Deletion requests (DSAR)
The address is **typed** in an interactive session, never put on a command line or in a task
override (those land in CloudTrail). The cluster does not log interactive sessions. Steps:

1. Start the idle ops task. It sleeps for 30 minutes; ECS Exec must be on:
   ```sh
   aws ecs run-task --region eu-west-1 --cluster <ClusterName> --launch-type FARGATE \
     --task-definition <the worker stack's Ops task definition> --enable-execute-command \
     --network-configuration "awsvpcConfiguration={subnets=[<public subnet>],securityGroups=[<WorkerSecurityGroup>],assignPublicIp=ENABLED}"
   ```
2. Open a session and run the command. It asks for the address and prints counts only:
   ```sh
   aws ecs execute-command --region eu-west-1 --cluster <ClusterName> --task <task id> \
     --container worker --interactive --command "node apps/worker/src/main.ts dsar-delete"
   ```
   (needs the Session Manager plugin for the AWS CLI)
3. Stop the task (`aws ecs stop-task …`), or let it end by itself after 30 minutes.

Delete the person's tickets in Freshdesk separately (ARCHITECTURE §4).

## Not automated yet
- **Load test:** needs this deployed target first (switch it on before the test).
- **Custom domains and HTTPS between CloudFront and the load balancer:** M6.
