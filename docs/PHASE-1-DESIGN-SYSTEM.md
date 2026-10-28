# Sahaara — Phase 1: Design System & Application Shell

Date: 2026-10-27 (UTC). Results below were observed in this session.

## Research note

The six reference sites were **not** inspected live this phase; the direction follows the principles recorded in Phase 0 (typography-led, restrained palette, depth through subtle layering, purposeful motion). No layouts, code or assets were copied.

## Design system (`src/styles.css`)

- **Theme:** light only. Warm paper neutrals + deep teal primary. Status hues: info (blue), success (green), warning (ochre), critical (clay red), each with a `-soft` background.
- **Tokens:** background / background-subtle / card / elevated; foreground / muted-foreground / subtle-foreground; border / border-strong; primary / primary-soft; disabled; ring. All oklch.
- **Type:** Bricolage Grotesque (headings, numbers) + Atkinson Hyperlegible Next (body; designed for low-vision legibility). Loaded via Google Fonts `<link>` with `display=swap` and system fallbacks. Utilities: `text-display`, `text-page-title`, `text-section`, `text-card-title`, `text-eyebrow`, `text-data` (tabular numerals).
- **Layout tokens:** `--sidebar-width` 16.5rem, `--header-height` 4rem, `--content-max` 76rem, `--page-pad-x`, `--card-pad`, radius 0.75rem base, three warm shadows, z-layers.
- **Motion:** 120/200/320 ms, `ease-standard`; `transition-standard`, `animate-rise` (page entry, once). Everything is disabled under `prefers-reduced-motion`.

## Shell

- `components/shell/app-shell.tsx` — skip link, fixed sidebar ≥1024px, sticky header + left drawer (Radix Sheet: focus trap, Esc, overlay) below.
- `components/shell/nav-list.tsx` + `lib/navigation.ts` — single nav config. Only real routes link; planned modules render as non-interactive items labelled with their phase. `aria-current="page"` on the active link.
- `components/shell/page.tsx` — `Page` (eyebrow, title, description, actions) and `Section`.
- `components/shell/states.tsx` — `StatusBadge`, `Notice`, `EmptyState` (icon + text, never color alone).
- `components/ui/button.tsx` — 44px default/icon targets, 2px focus outline, `loading` state, token-based disabled.

## Routes

- `/` Overview — honest setup notice, empty caseload, planned modules. No fabricated data.
- `/design-system` — living reference of tokens and components, with a local-only validated demo form (labelled as not stored).

## Verification

| Check                                          | Result                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `bun run lint`                                 | Pass — 0 errors, 6 pre-existing shadcn warnings                   |
| `bunx tsgo --noEmit`                           | Pass                                                              |
| `bun run test`                                 | Pass — 2 files, 5 tests (incl. new `src/test/navigation.test.ts`) |
| `bun run build`                                | Pass                                                              |
| Playwright 1440×1000, 820×1100, 375×800        | No horizontal overflow; no page errors                            |
| Mobile drawer                                  | Opens, closes on Esc, closes after navigating                     |
| Active state                                   | `aria-current` moves to "Design system" after navigation          |
| Keyboard                                       | First Tab lands on "Skip to content"                              |
| Form validation                                | Empty submit shows linked error message                           |
| axe-core 4.10 (`/`, `/design-system`, desktop) | 0 violations                                                      |
| Lighthouse                                     | Not run (not available in sandbox)                                |

Limitations: axe is automated only; no screen-reader testing performed; WCAG 2.2 AA not claimed.

## Known issues / deferred

- Fonts are third-party (Google Fonts); consider self-hosting for privacy in the security phase.
- No dark theme (intentional).
- Settings and all care modules are planned, not built.
