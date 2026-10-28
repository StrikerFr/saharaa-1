import { cn } from "@/lib/utils";

/** Original Sahaara mark: two arcs meeting — a supporting hand around a point of care. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M9 19.5c0 4 3.1 6.5 7 6.5s7-2.5 7-6.5"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="12" r="3.6" className="fill-primary-foreground" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="font-display text-xl font-semibold tracking-tight text-foreground">
        sahaara
      </span>
    </span>
  );
}
