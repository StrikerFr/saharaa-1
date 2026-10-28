import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email.")
  .max(255)
  .email("Enter a valid email address.");
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});
export const signUpSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use at most 80 characters."),
  email: emailSchema,
  password: passwordSchema,
});
export const displayNameSchema = signUpSchema.shape.displayName;

export const roleSchema = z.enum(["admin", "coordinator", "senior", "family"]);
export type AppRole = z.infer<typeof roleSchema>;
export const uuidSchema = z.string().uuid();

/**
 * Only same-origin relative paths are allowed as post-login destinations.
 * Rejects absolute URLs, protocol-relative ("//evil"), backslash tricks and auth pages.
 */
export function safeRedirect(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if ([...value].some((ch) => ch.charCodeAt(0) < 32)) return fallback;
  if (value.startsWith("/auth") || value.startsWith("/reset-password")) return fallback;
  return value;
}

/** Maps backend errors to safe, user-facing messages (never echoes internals). */
export function friendlyAuthError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match an account.";
  if (m.includes("email not confirmed"))
    return "Confirm your email first — check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with this email may already exist. Try signing in.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("weak") || m.includes("pwned") || m.includes("leaked"))
    return "That password is too common or has appeared in a data breach. Choose another.";
  if (m.includes("forbidden")) return "You don't have permission to do that.";
  if (m.includes("cannot_remove_own_admin")) return "You can't remove your own administrator role.";
  return "Something went wrong. Please try again.";
}
