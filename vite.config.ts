// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Lovable's publish pipeline always ships to Cloudflare Workers and forces that
// target itself, so these two variables only tell us "this is a Lovable build".
// Anywhere else — Vercel, other CI, a plain `bun run build` — we emit the Vercel
// Build Output bundle (.vercel/output) instead.
const isLovableBuild =
  process.env["LOVABLE_SANDBOX"] === "1" || !!process.env["DEV_SERVER__PROJECT_PATH"];

// The runtime pin keeps plain Node.js serverless functions even when the build
// itself runs under Bun (`bun run build` on Vercel).
const vercelNitro = {
  preset: "vercel",
  vercel: { functions: { runtime: "nodejs22.x" } },
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...(isLovableBuild ? {} : { nitro: vercelNitro }),
});
