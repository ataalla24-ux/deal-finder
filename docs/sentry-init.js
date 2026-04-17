(function initFreeFinderSentry() {
  if (!window.Sentry) {
    return;
  }

  const hostname = window.location.hostname || "";
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local");

  window.Sentry.init({
    dsn: "https://223ae032fc0cc8d814902970a35a1097@o4511235451584512.ingest.de.sentry.io/4511235606904912",
    environment: isLocal ? "development" : "production",
    tracesSampleRate: isLocal ? 0.0 : 0.1,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
    ],
    initialScope: {
      tags: {
        app: "freefinder",
        runtime: "browser",
        surface: "web",
      },
    },
  });
})();
