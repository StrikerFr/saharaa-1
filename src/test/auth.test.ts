import { describe, expect, it } from "vitest";
import { friendlyAuthError, safeRedirect, signUpSchema } from "@/lib/auth";
import { primaryNav, secondaryNav, visibleNav } from "@/lib/navigation";

describe("safeRedirect", () => {
  it("keeps same-origin paths", () => {
    expect(safeRedirect("/admin?tab=1")).toBe("/admin?tab=1");
  });
  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "/auth?x",
    "",
    undefined,
    42,
  ])("rejects %s", (v) => {
    expect(safeRedirect(v)).toBe("/account");
  });
});

describe("signUpSchema", () => {
  it("requires passwords of at least 10 characters", () => {
    expect(
      signUpSchema.safeParse({ displayName: "Asha", email: "a@b.co", password: "123456789" })
        .success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ displayName: "Asha", email: "a@b.co", password: "1234567890" })
        .success,
    ).toBe(true);
  });
});

describe("friendlyAuthError", () => {
  it("never echoes raw backend messages", () => {
    expect(friendlyAuthError('relation "x" violates policy at line 3')).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("role-gated navigation", () => {
  it("hides Administration from non-admins and shows it to admins", () => {
    const labels = (r: Parameters<typeof visibleNav>[1]) =>
      visibleNav(secondaryNav, r).map((i) => i.label);
    expect(labels([])).not.toContain("Administration");
    expect(labels(["coordinator"])).not.toContain("Administration");
    expect(labels(["admin"])).toContain("Administration");
    expect(visibleNav(primaryNav, [])).toHaveLength(primaryNav.length);
  });
});
