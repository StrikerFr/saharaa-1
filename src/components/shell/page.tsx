import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; link?: LinkProps };

/** Standard page frame: breadcrumbs, compact header (eyebrow, title, description, actions) + content. */
export function Page({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  children: ReactNode;
}) {
  return (
    <div className="page-container animate-rise py-6 lg:py-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((c, i) => (
              <li key={c.label} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden="true" />}
                {c.link ? (
                  <Link {...c.link} className="rounded hover:text-foreground hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-3xl">
          {eyebrow && <p className="text-eyebrow mb-2 text-primary">{eyebrow}</p>}
          <h1 className="text-page-title">{title}</h1>
          {description && <div className="mt-2 text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-8 pt-6">{children}</div>
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-section">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
