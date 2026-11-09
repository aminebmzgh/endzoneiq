import type { Instrumentation } from "next";

/** Uncaught server errors (renders, route handlers, proxy) go to Sentry when it is configured. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const { captureError } = await import("@/lib/observability/sentry");
  await captureError(err, {
    source: context.routeType,
    path: request.path.split("?")[0],
    method: request.method,
    tags: { route: context.routePath },
  });
};
