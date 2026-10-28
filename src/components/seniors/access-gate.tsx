import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { EmptyState, Notice } from "@/components/shell/states";
import { useCareAccess } from "@/hooks/use-care-access";

export function CareAccessGate({
  userId,
  children,
}: {
  userId: string;
  children: (orgName: string) => ReactNode;
}) {
  const a = useCareAccess(userId);
  if (a.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        Checking your access…
      </p>
    );
  if (a.isError)
    return <Notice tone="critical" title="Couldn't check your access. Refresh to try again." />;
  if (!a.canAccess)
    return (
      <EmptyState icon={Lock} title="No access to senior records">
        {!a.hasRole
          ? "Senior records are available to care coordinators and administrators. Ask an administrator to assign you a role."
          : "Your account isn't part of an organisation yet. Ask an administrator to add you to one."}
      </EmptyState>
    );
  return <>{children(a.org?.name ?? "")}</>;
}
