import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { MailCheck } from "lucide-react";

import { Field } from "@/components/auth/field";
import { Notice } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  emailSchema,
  friendlyAuthError,
  safeRedirect,
  signInSchema,
  signUpSchema,
} from "@/lib/auth";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in — Sahaara" },
      { name: "description", content: "Sign in to the Sahaara care-coordination workspace." },
      { property: "og:title", content: "Sign in — Sahaara" },
      {
        property: "og:description",
        content: "Sign in to the Sahaara care-coordination workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
      { property: "og:url", content: "https://saharaa-1.vercel.app/auth" },
    ],
    links: [{ rel: "canonical", href: "https://saharaa-1.vercel.app/auth" }],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";
type Errors = Partial<Record<"displayName" | "email" | "password", string>>;

function fieldErrors(issues: z.ZodIssue[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const k = i.path[0] as keyof Errors;
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const target = safeRedirect(search.redirect);
  const [mode, setMode] = useState<Mode>("signin");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "confirm" | "reset">(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: target, replace: true });
    });
  }, [navigate, target]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const fd = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    try {
      if (mode === "signin") {
        const p = signInSchema.safeParse(fd);
        if (!p.success) return setErrors(fieldErrors(p.error.issues));
        setErrors({});
        const { data, error } = await supabase.auth.signInWithPassword(p.data);
        if (error || !data.session) return setFormError(friendlyAuthError(error?.message));
        navigate({ to: target, replace: true });
      } else if (mode === "signup") {
        const p = signUpSchema.safeParse(fd);
        if (!p.success) return setErrors(fieldErrors(p.error.issues));
        setErrors({});
        const { data, error } = await supabase.auth.signUp({
          email: p.data.email,
          password: p.data.password,
          options: {
            emailRedirectTo: window.location.origin + "/auth",
            data: { display_name: p.data.displayName },
          },
        });
        if (error) return setFormError(friendlyAuthError(error.message));
        if (data.session) navigate({ to: target, replace: true });
        else setPending("confirm");
      } else {
        const p = emailSchema.safeParse(fd["email"]);
        if (!p.success) return setErrors({ email: p.error.issues[0]?.message ?? "Invalid email" });
        setErrors({});
        const { error } = await supabase.auth.resetPasswordForEmail(p.data, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) return setFormError(friendlyAuthError(error.message));
        setPending("reset");
      }
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Mode, string> = {
    signin: "Sign in",
    signup: "Create an account",
    forgot: "Reset your password",
  };

  return (
    <div className="page-container flex min-h-[calc(100dvh-var(--header-height))] items-center justify-center py-12 lg:min-h-dvh">
      <div className="w-full max-w-md">
        <p className="text-eyebrow mb-3 text-primary">Sahaara workspace</p>
        <h1 className="text-page-title">{titles[mode]}</h1>

        {pending ? (
          <div className="surface mt-8 flex flex-col items-start gap-4 p-6" role="status">
            <MailCheck className="size-8 text-primary" aria-hidden="true" />
            <p className="text-card-title">Check your email</p>
            <p className="text-muted-foreground">
              {pending === "confirm"
                ? "We sent a confirmation link. You'll be able to sign in once you've confirmed your address."
                : "If an account exists for that address, a reset link is on its way."}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null);
                setMode("signin");
              }}
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={onSubmit}
            className="surface mt-8 flex flex-col gap-5 p-6"
            aria-describedby={formError ? "form-error" : undefined}
          >
            {formError && (
              <div id="form-error">
                <Notice tone="critical" title={formError} />
              </div>
            )}
            {mode === "signup" && (
              <Field
                id="displayName"
                name="displayName"
                label="Your name"
                autoComplete="name"
                error={errors.displayName}
              />
            )}
            <Field
              id="email"
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              error={errors.email}
            />
            {mode !== "forgot" && (
              <Field
                id="password"
                name="password"
                type="password"
                label="Password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                error={errors.password}
                hint={mode === "signup" ? "At least 10 characters." : undefined}
              />
            )}
            <Button type="submit" loading={busy} className="w-full">
              {mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
            </Button>
            {mode === "signup" && (
              <p className="text-sm text-muted-foreground">
                New accounts have no access to care data until an administrator assigns a role.
              </p>
            )}
          </form>
        )}

        {!pending && (
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem]">
            {mode !== "signin" && (
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => {
                  setMode("signin");
                  setErrors({});
                  setFormError(null);
                }}
              >
                Have an account? Sign in
              </Button>
            )}
            {mode !== "signup" && (
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => {
                  setMode("signup");
                  setErrors({});
                  setFormError(null);
                }}
              >
                Create an account
              </Button>
            )}
            {mode === "signin" && (
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => {
                  setMode("forgot");
                  setErrors({});
                  setFormError(null);
                }}
              >
                Forgot password?
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
