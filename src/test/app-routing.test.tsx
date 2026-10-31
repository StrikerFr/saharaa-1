import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches senior profile with and without trailing slash", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const withSlash = router.matchRoutes("/seniors/11111111-1111-1111-1111-111111111111/");
    const withoutSlash = router.matchRoutes("/seniors/11111111-1111-1111-1111-111111111111");

    console.log("withSlash matches:", withSlash.map(m => m.routeId));
    console.log("withoutSlash matches:", withoutSlash.map(m => m.routeId));

    expect(withSlash.at(-1)?.routeId).toBe("/_authenticated/seniors/$seniorId/");
    expect(withoutSlash.at(-1)?.routeId).toBe("/_authenticated/seniors/$seniorId/");
  });

  it("matches alerts directory and deep alert routes without falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const alertsMatch = router.matchRoutes("/alerts");
    const deepAlertMatch = router.matchRoutes("/alerts/a6ea209e-fa00-4d6c-ba40-50631a825364");
    const seniorAlertsMatch = router.matchRoutes("/seniors/f04d791b-755d-5b24-8776-a62354e4de37/alerts");

    expect(alertsMatch.at(-1)?.routeId).not.toBe(rootRouteId);
    expect(deepAlertMatch.at(-1)?.routeId).toBe("/_authenticated/alerts/$alertId");
    expect(seniorAlertsMatch.at(-1)?.routeId).toBe("/_authenticated/seniors/$seniorId/alerts");
  });
});
