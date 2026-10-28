import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";

import { isNavActive, primaryNav, secondaryNav } from "@/lib/navigation";
import { routeTree } from "@/routeTree.gen";

describe("navigation", () => {
  it("Overview is active only on /", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/", "/design-system")).toBe(false);
  });

  it("section links stay active on nested paths but not on lookalikes", () => {
    expect(isNavActive("/design-system", "/design-system/tokens")).toBe(true);
    expect(isNavActive("/design-system", "/design-systemx")).toBe(false);
  });

  it("every available nav item resolves to a real route", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const item of [...primaryNav, ...secondaryNav]) {
      if (item.status !== "available") continue;
      expect(router.matchRoutes(item.to).at(-1)?.routeId).not.toBe(rootRouteId);
    }
  });

  it("no navigation item shows a development-phase marker", () => {
    expect([...primaryNav, ...secondaryNav].filter((i) => i.status === "planned")).toEqual([]);
  });
});
