import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useSession } from "@/hooks/use-session";
import { primaryNav, secondaryNav, visibleNav } from "@/lib/navigation";
import { Wordmark } from "./brand";
import { NavList } from "./nav-list";
import { OrgSwitcher } from "./org-switcher";

function SessionControl({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { session, ready } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!ready) return <div className="h-11" aria-hidden="true" />;
  if (!session)
    return (
      <Button asChild variant="outline" className="w-full">
        <Link to="/auth" search={{}} onClick={onNavigate}>
          <LogIn aria-hidden="true" /> Sign in
        </Link>
      </Button>
    );

  async function signOut() {
    setBusy(true);
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    setBusy(false);
    onNavigate?.();
    navigate({ to: "/auth", search: {}, replace: true });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="truncate px-1 text-sm text-muted-foreground" title={session.user.email}>
        Signed in as <span className="font-semibold text-foreground">{session.user.email}</span>
      </p>
      <Button variant="outline" className="w-full" loading={busy} onClick={signOut}>
        {!busy && <LogOut aria-hidden="true" />} Sign out
      </Button>
    </div>
  );
}

function NavContent({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { session } = useSession();
  const roles = useMyRoles(session?.user.id);
  const r = roles.data ?? [];
  return (
    <div className="flex flex-1 flex-col gap-8">
      <NavList items={visibleNav(primaryNav, r)} label="Care" onNavigate={onNavigate} />
      <NavList items={visibleNav(secondaryNav, r)} label="Workspace" onNavigate={onNavigate} />
      <div className="mt-auto flex flex-col gap-4">
        {session && <OrgSwitcher userId={session.user.id} isAdmin={r.includes("admin")} />}
        <SessionControl onNavigate={onNavigate} />
        <p className="rounded-lg bg-background-subtle p-3 text-sm text-muted-foreground">
          Sahaara supports coordinators. It does not diagnose or replace clinical or emergency care.
        </p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-elevated focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>

      <aside
        className="fixed inset-y-0 left-0 hidden w-[var(--sidebar-width)] flex-col gap-8 border-r border-sidebar-border bg-sidebar px-4 py-6 lg:flex"
        aria-label="Primary"
      >
        <Link to="/" className="rounded-lg px-2" aria-label="Sahaara home">
          <Wordmark />
        </Link>
        <nav aria-label="Main navigation" className="flex flex-1 flex-col">
          <NavContent />
        </nav>
      </aside>

      <header className="sticky top-0 z-[var(--z-header)] flex h-[var(--header-height)] items-center justify-between border-b border-border bg-background/95 px-[var(--page-pad-x)] lg:hidden">
        <Link to="/" className="rounded-lg" aria-label="Sahaara home">
          <Wordmark />
        </Link>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-[min(20rem,88vw)] flex-col gap-8 bg-sidebar p-5"
          >
            <SheetTitle asChild>
              <div>
                <Wordmark />
              </div>
            </SheetTitle>
            <SheetDescription className="sr-only">Main navigation</SheetDescription>
            <nav aria-label="Main navigation" className="flex flex-1 flex-col">
              <NavContent onNavigate={() => setOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      <main id="main" tabIndex={-1} className="outline-none lg:pl-[var(--sidebar-width)]">
        {children}
      </main>
    </div>
  );
}
