# Slack Live Deal Review Setup

The daily `Live Deals Slack Review` workflow sends all live app deals to Slack with one `Entfernen` button per deal.

Button clicks go to the Cloudflare Worker. The Worker verifies Slack's request signature, dispatches the existing `Deal Moderation` GitHub Action, and the action removes the deal from the published JSON feeds. Once GitHub Pages updates, the deal disappears from iOS, Web, and Android because all clients read the same `deals.json`.

## Slack App

Enable Slack interactivity and set the Request URL to:

```text
https://freefinder-referrals.freefinder-stefan.workers.dev/api/slack/interactions
```

The Slack bot also needs permission to post messages to the review channel. The existing repository secrets are used by the scheduled workflow:

```text
SLACK_BOT_TOKEN
SLACK_CHANNEL_ID
```

## Worker Secrets

Set these Cloudflare Worker secrets:

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put GITHUB_WORKFLOW_TOKEN
```

`GITHUB_WORKFLOW_TOKEN` should be a fine-grained GitHub token for `ataalla24-ux/deal-finder` with permission to dispatch GitHub Actions workflows.

Optional Worker overrides:

```bash
npx wrangler secret put GITHUB_OWNER
npx wrangler secret put GITHUB_REPO
npx wrangler secret put GITHUB_REF
npx wrangler secret put GITHUB_DEAL_MODERATION_WORKFLOW
```

## Manual Admin Removal

The same Worker can trigger removal with an admin token:

```bash
curl -X POST "https://freefinder-referrals.freefinder-stefan.workers.dev/api/deals/admin/remove" \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dealId":"community:41aa7928-48b2-4ef1-b570-b67f3e5d1e3c","reason":"abgelaufen"}'
```

## Local Dry Run

Preview the Slack message payload without posting:

```bash
SLACK_LIVE_REVIEW_DRY_RUN=1 SLACK_CHANNEL_ID=dry-run npm run slack-live-review
```
