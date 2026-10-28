import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Field } from "@/components/auth/field";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, passwordSchema } from "@/lib/auth";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Sahaara" },
      { name: "description", content: "Choose a new password for your Sahaara account." },
      { property: "og:title", content: "Set a new password — Sahaara" },
      { property: "og:description", content: "Choose a new password for your Sahaara account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid">("checking");
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady("ok");
    });
    const isRecovery = window.location.hash.includes("type=recovery");
    const t = setTimeout(() => {
      supabase.auth.getSession().then(({ data: d }) => {
        setReady((r) => (r === "ok" ? r : d.session && isRecovery ? "ok" : "invalid"));
      });
    }, 800);
    return () => {
      clearTimeout(t);
      data.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = passwordSchema.safeParse(new FormData(e.currentTarget).get("password"));
    if (!p.success) return setError(p.error.issues[0]?.message);
    setError(undefined);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: p.data });
    setBusy(false);
    if (err) return setFormError(friendlyAuthError(err.message));
    navigate({ to: "/account", replace: true });
  }

  return (
    <div className="page-container flex min-h-dvh items-center justify-center py-12">
      <div className="w-full max-w-md">
        <h1 className="text-page-title">Set a new password</h1>
        {ready === "checking" && (
          <p className="mt-6 text-muted-foreground" role="status">
            Checking your reset link…
          </p>
        )}
        {ready === "invalid" && (
          <div className="mt-6 flex flex-col gap-4">
            <Notice tone="warning" title="This reset link is invalid or has expired." />
            <Link
              to="/auth"
              search={{}}
              className="font-semibold text-primary underline underline-offset-4"
            >
              Request a new link
            </Link>
          </div>
        )}
        {ready === "ok" && (
          <form noValidate onSubmit={onSubmit} className="surface mt-8 flex flex-col gap-5 p-6">
            {formError && <Notice tone="critical" title={formError} />}
            <Field
              id="password"
              name="password"
              type="password"
              label="New password"
              autoComplete="new-password"
              error={error}
              hint="At least 10 characters."
            />
            <Button type="submit" loading={busy}>
              Save password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
