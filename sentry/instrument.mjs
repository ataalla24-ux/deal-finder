import * as Sentry from "@sentry/node";

const DEFAULT_DSN =
  "https://223ae032fc0cc8d814902970a35a1097@o4511235451584512.ingest.de.sentry.io/4511235606904912";

const environment =
  process.env.SENTRY_ENVIRONMENT ||
  (process.env.GITHUB_ACTIONS === "true"
    ? "production"
    : process.env.NODE_ENV || "development");

const release =
  process.env.SENTRY_RELEASE ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "freefinder-wien@local";

const dsn = process.env.SENTRY_DSN || DEFAULT_DSN;
const sentryEnabled = process.env.SENTRY_DISABLED !== "1" && Boolean(dsn);

if (sentryEnabled && !globalThis.__FREEFINDER_SENTRY_INITIALIZED__) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: process.env.GITHUB_ACTIONS === "true" ? 0.2 : 0.05,
    sendDefaultPii: false,
    initialScope: {
      tags: {
        app: "freefinder",
        runtime: "node",
        github_actions: process.env.GITHUB_ACTIONS === "true" ? "true" : "false",
      },
    },
  });

  globalThis.__FREEFINDER_SENTRY_INITIALIZED__ = true;
}

export { Sentry, sentryEnabled };
