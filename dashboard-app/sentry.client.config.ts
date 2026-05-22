import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://27a789052e1a64619f7d385a36728d41@o4511431521468416.ingest.us.sentry.io/4511431522713600",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
