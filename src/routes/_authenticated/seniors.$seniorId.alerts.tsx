import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Route alias for /seniors/$seniorId/alerts.
 * Redirects directly to /seniors/$seniorId?tab=alerts so deep links and manual navigation
 * never show 404 Page Not Found.
 */
export const Route = createFileRoute("/_authenticated/seniors/$seniorId/alerts")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/seniors/$seniorId",
      params: { seniorId: params.seniorId },
      search: { tab: "alerts" },
    });
  },
  component: () => null,
});

