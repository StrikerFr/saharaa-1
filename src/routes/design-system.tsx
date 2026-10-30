import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox, Search } from "lucide-react";
import { toast } from "sonner";

import { Page, Section } from "@/components/shell/page";
import { EmptyState, Notice, StatusBadge } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/design-system")({
  head: () => ({
    meta: [
      { title: "Design system — Sahaara" },
      { name: "description", content: "Sahaara's tokens, typography and interface components." },
      { property: "og:title", content: "Design system — Sahaara" },
      {
        property: "og:description",
        content: "Sahaara's tokens, typography and interface components.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://saharaa-1.vercel.app/design-system" },
    ],
    links: [{ rel: "canonical", href: "https://saharaa-1.vercel.app/design-system" }],
  }),
  component: DesignSystem,
});

const swatches = [
  ["Background", "bg-background"],
  ["Subtle", "bg-background-subtle"],
  ["Surface", "bg-card"],
  ["Primary", "bg-primary"],
  ["Primary soft", "bg-primary-soft"],
  ["Info", "bg-info"],
  ["Success", "bg-success"],
  ["Warning", "bg-warning"],
  ["Critical", "bg-critical"],
  ["Border", "bg-border-strong"],
] as const;

function ExampleForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      noValidate
      className="surface flex max-w-md flex-col gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) {
          setError("Enter at least 2 characters.");
          return;
        }
        setError(null);
        setSaving(true);
        // Local-only demo: validates input; nothing is sent or stored.
        setTimeout(() => {
          setSaving(false);
          toast("Input validated locally", { description: "Nothing was saved — demo form." });
        }, 600);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="ds-name">Coordinator name</Label>
        <Input
          id="ds-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ds-name-error" : "ds-name-hint"}
        />
        {error ? (
          <p id="ds-name-error" className="text-sm font-semibold text-critical">
            {error}
          </p>
        ) : (
          <p id="ds-name-hint" className="text-sm text-muted-foreground">
            Demo only — validated in your browser, not stored.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="ds-check" />
        <Label htmlFor="ds-check">Show me first in rotations</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="ds-switch" />
        <Label htmlFor="ds-switch">Compact density</Label>
      </div>
      <Button type="submit" loading={saving} className="self-start">
        Validate
      </Button>
    </form>
  );
}

function DesignSystem() {
  return (
    <Page
      eyebrow="Foundation"
      title="Design system"
      description="The shared tokens and components every Sahaara screen is built from."
    >
      <Section title="Color" description="Status colors always appear with an icon and a label.">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map(([name, cls]) => (
            <li key={name} className="surface overflow-hidden">
              <div className={`h-16 ${cls}`} />
              <p className="px-3 py-2 text-sm font-semibold">{name}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Typography"
        description="Bricolage Grotesque for headings, Atkinson Hyperlegible Next for reading."
      >
        <div className="surface flex flex-col gap-4 p-6">
          <p className="text-display">Display 56</p>
          <p className="text-page-title">Page title 36</p>
          <p className="text-section">Section heading 20</p>
          <p className="text-card-title">Card title 17</p>
          <p>Body 16 — clear, generous line height for long reading.</p>
          <p className="text-sm text-muted-foreground">Supporting 14 — secondary detail.</p>
          <p className="text-eyebrow text-primary">Label · eyebrow</p>
          <p className="text-data text-3xl">1,284 · 07:45 · 98.6</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="outline">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Critical</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button variant="outline" size="icon" aria-label="Search">
            <Search />
          </Button>
        </div>
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">Information</StatusBadge>
          <StatusBadge tone="success">Resolved</StatusBadge>
          <StatusBadge tone="warning">Needs review</StatusBadge>
          <StatusBadge tone="critical">Urgent</StatusBadge>
          <StatusBadge tone="neutral">Draft</StatusBadge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Notice tone="warning" title="Observation, not a diagnosis">
            Changes are signals for a human to review.
          </Notice>
          <Notice tone="critical" title="Example urgent notice">
            Urgent items use strong color, an icon, and plain words.
          </Notice>
        </div>
      </Section>

      <Section title="Form controls">
        <ExampleForm />
      </Section>

      <Section title="Empty state">
        <EmptyState icon={Inbox} title="Nothing here yet">
          Empty states explain what will appear and why.
        </EmptyState>
      </Section>
    </Page>
  );
}
