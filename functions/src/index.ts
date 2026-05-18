import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp();
}

const APP_URL = "https://partnersinbiz.online";

async function callCronEndpoint(path: string, label: string, init: RequestInit = {}) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(`[${label}] CRON_SECRET not set in function env`);
    return;
  }

  const response = await fetch(`${APP_URL}${path}`, {
    method: init.method ?? "GET",
    ...init,
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[${label}] HTTP ${response.status}: ${body}`);
    return;
  }

  const body = await response.text();
  console.log(`[${label}] OK ${response.status}${body ? ` ${body.slice(0, 500)}` : ""}`);
}

function scheduledCron(
  name: string,
  path: string,
  schedule: string,
  init: RequestInit = {},
) {
  return onSchedule(
    {
      schedule,
      timeZone: "UTC",
      secrets: ["CRON_SECRET"],
    },
    async () => {
      await callCronEndpoint(path, name, init);
    }
  );
}

/**
 * Scheduled function: runs every 5 minutes to process the social post queue.
 *
 * Replaces the Vercel cron job which is limited to daily on the Hobby plan.
 * Firebase Cloud Scheduler allows sub-minute granularity on the Blaze plan.
 *
 * This function calls our own /api/cron/social endpoint with the AI_API_KEY,
 * which processes any scheduled posts that are due for publishing.
 */
export const publishSocialQueue = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "UTC",
    secrets: ["AI_API_KEY"],
  },
  async () => {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      console.error("[social-cron] AI_API_KEY not set in function env");
      return;
    }

    const url = `${APP_URL}/api/cron/social`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[social-cron] HTTP ${response.status}: ${body}`);
        return;
      }

      const data = (await response.json()) as {
        success: boolean;
        data: { processed: number; failed: number; skipped: number; errors: unknown[] };
      };

      if (data.success) {
        const { processed, failed, skipped } = data.data;
        console.log(
          `[social-cron] Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`
        );
        if (data.data.errors && data.data.errors.length > 0) {
          console.error("[social-cron] Errors:", JSON.stringify(data.data.errors));
        }
      } else {
        console.error("[social-cron] API returned failure:", JSON.stringify(data));
      }
    } catch (err) {
      console.error("[social-cron] Fetch error:", err);
    }
  }
);

export const runEmailSequences = scheduledCron(
  "email-sequences",
  "/api/cron/sequences",
  "0 6 * * *"
);

export const runEmailQueue = scheduledCron(
  "email-queue",
  "/api/cron/emails",
  "0 6 * * *"
);

export const runEmailBroadcasts = scheduledCron(
  "email-broadcasts",
  "/api/cron/broadcasts",
  "0 6 * * *"
);

export const runSocialRss = scheduledCron(
  "social-rss",
  "/api/cron/social-rss",
  "0 8 * * *"
);

export const runSocialAnalytics = scheduledCron(
  "social-analytics",
  "/api/cron/social-analytics",
  "0 9 * * *"
);

export const runSocialInboxPoll = scheduledCron(
  "social-inbox-poll",
  "/api/cron/social-inbox-poll",
  "0 10 * * *"
);

export const runRecurringInvoices = scheduledCron(
  "recurring-invoices",
  "/api/cron/invoices",
  "0 2 * * *"
);

export const runWebhookQueue = scheduledCron(
  "webhook-queue",
  "/api/cron/webhooks",
  "0 0 * * *"
);

export const runIntegrationSync = scheduledCron(
  "integration-sync",
  "/api/cron/integrations",
  "0 3 * * *"
);

export const runCrmIntegrationSync = scheduledCron(
  "crm-integration-sync",
  "/api/cron/crm-integrations",
  "0 5 * * *"
);

export const runMonthlyReports = scheduledCron(
  "monthly-reports",
  "/api/cron/reports",
  "0 6 1 * *"
);

export const runAnomalyChecks = scheduledCron(
  "anomaly-checks",
  "/api/cron/anomalies",
  "30 6 * * *"
);

export const runSeoDaily = scheduledCron(
  "seo-daily",
  "/api/cron/seo-daily",
  "0 4 * * *"
);

export const runSeoWeekly = scheduledCron(
  "seo-weekly",
  "/api/cron/seo-weekly",
  "0 5 * * 1"
);

export const runAdsRefreshQueue = scheduledCron(
  "ads-refresh-queue",
  "/api/v1/ads/cron/process-refresh-queue",
  "every 5 minutes"
);

export const runAdsDailyInsights = scheduledCron(
  "ads-daily-insights",
  "/api/v1/ads/cron/daily-insights-pull",
  "30 0 * * *"
);

export const runAdsBudgetPacing = scheduledCron(
  "ads-budget-pacing",
  "/api/v1/ads/cron/budget-pacing-check",
  "0 */6 * * *"
);

export const runAdsExperimentSignificance = scheduledCron(
  "ads-experiment-significance",
  "/api/v1/ads/cron/experiment-significance-check",
  "0 */6 * * *"
);

export const runCrmScoreRecompute = scheduledCron(
  "crm-score-recompute",
  "/api/v1/crm/cron/recompute-scores",
  "0 2 * * *"
);

export const runCrmAutomationQueue = scheduledCron(
  "crm-automation-queue",
  "/api/v1/crm/cron/process-automations",
  "every 5 minutes"
);

export const runCrmSequenceQueue = scheduledCron(
  "crm-sequence-queue",
  "/api/v1/crm/cron/process-sequences",
  "every 5 minutes"
);

/**
 * Scheduled function: daily check for stale social account tokens.
 * Runs at 3 AM UTC. The actual refresh is handled during publish attempts.
 * This cron just logs which accounts haven't been refreshed in 30+ days.
 */
export const checkStaleTokens = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
  },
  async () => {
    const db = admin.firestore();
    const thirtyDaysAgo = admin.firestore.Timestamp.fromMillis(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    const staleAccounts = await db
      .collection("social_accounts")
      .where("status", "==", "active")
      .get();

    let needAttention = 0;

    for (const doc of staleAccounts.docs) {
      const account = doc.data();
      const lastRefresh = account.lastTokenRefresh;

      if (lastRefresh && lastRefresh.seconds > thirtyDaysAgo.seconds) {
        continue;
      }

      console.log(
        `[token-check] ${account.platform}/${account.username} — last refresh: ${lastRefresh ? new Date(lastRefresh.seconds * 1000).toISOString() : "never"}`
      );
      needAttention++;
    }

    console.log(
      `[token-check] Checked ${staleAccounts.size} accounts, ${needAttention} need attention`
    );
  }
);
