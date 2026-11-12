# Deploying preprod

Preprod is the only deployed environment until M6. Deploys run from GitHub Actions
(**Actions → Deploy preprod → Run workflow**), with no AWS keys stored anywhere. What gets
deployed:

| Stack | Region | Contents |
|---|---|---|
| `TrainmoreChatbot-preprod` | eu-west-1 | network, ECS cluster, ECR, encrypted logs, secrets, SES sender |
| `TrainmoreChatbot-preprod-waf` | us-east-1 | WAF for CloudFront (managed rules, per-IP rate limit) |
| `TrainmoreChatbot-preprod-service` | eu-west-1 | CloudFront (widget + API on one domain), S3, internal ALB, API on Fargate with mock Magicline |
| `TrainmoreChatbot-preprod-worker` | eu-west-1 | nightly FAQ sync (02:00), topic sync (02:15), retention (03:00), Amsterdam time |

Preprod always uses the **mock Magicline** with synthetic profiles. Real Magicline keys come with
M6. Expected cost is about $55/month, excluding Claude usage (see ARCHITECTURE §2).

## One-time setup

### 1. AWS account
- Use a dedicated account for the chatbot if possible (production will get its own later).
- Bootstrap CDK in **both** regions (the WAF must live in us-east-1):
  ```sh
  npx cdk bootstrap aws://<ACCOUNT_ID>/eu-west-1 aws://<ACCOUNT_ID>/us-east-1
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
3. Give it this permissions policy. It may use the CDK bootstrap roles and push the image:
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
Settings → Environments → **preprod** (add yourself as required reviewer), then:

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_DEPLOY_ROLE_ARN` | ARN of the role from step 2 |
| Variable | `EMAIL_FROM` | sender of login codes, e.g. `chatbot-preprod@trainmore.nl` |
| Variable | `TURNSTILE_SITE_KEY` | Turnstile site key (public) |
| Variable | `PRIVACY_URL` | privacy statement URL shown in the consent notice |
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
   - **SES:** click the verification link sent to `EMAIL_FROM`. While SES is in sandbox mode, also
     verify each tester's address (SES → Identities), because login codes only reach verified
     addresses.
3. **Full deploy.** Run the workflow again without the tick. It does the following:
   1. runs the tests
   2. builds the widget
   3. applies the database migrations
   4. builds and pushes the ARM image (tagged with the commit)
   5. deploys WAF, service and worker schedules

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

## Routine deploys
Run **Deploy preprod**. Images are tagged with the commit and are immutable, so redeploying the
same commit reuses its image.

## Deletion requests (DSAR)
Run `dsar-delete` in an **interactive** session on a worker task and type the address when asked
(ARCHITECTURE §4). Never put the address on a command line or in a task override: those land in
CloudTrail.

## Not automated yet
- **Load test:** needs this deployed target first.
- **Custom domains and HTTPS between CloudFront and the load balancer:** M6.
- **The ALB's inbound rule** allows the VPC range (the ALB is internal). It can be narrowed to
  CloudFront's VPC-origin security group once that exists.
