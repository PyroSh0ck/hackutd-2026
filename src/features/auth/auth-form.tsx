"use client";

import { useState, type SubmitEvent } from "react";
import { TextField } from "@/components/forms/text-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
  /** Where to go after success. Internal paths only. */
  redirectTo?: `/${string}`;
};

// Fields intentionally omit the `required` marker so labels stay exactly "Name"/"Email"/"Password";
// Better Auth validates server-side and errors are shown in the alert.
export function AuthForm({ mode, redirectTo = "/" }: AuthFormProps) {
  const isSignUp = mode === "sign-up";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    setPending(true);
    setError(null);

    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: String(formData.get("name") ?? "").trim(), email, password })
        : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message ?? "Authentication failed.");
        return;
      }

      // Full navigation (not router.push) so every client component re-reads the new session.
      window.location.assign(redirectTo);
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-4" aria-busy={pending}>
      {isSignUp && <TextField label="Name" name="name" autoComplete="name" maxLength={100} />}
      <TextField label="Email" name="email" type="email" autoComplete="email" />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete={isSignUp ? "new-password" : "current-password"}
        minLength={8}
        maxLength={128}
      />

      {error && <Alert tone="danger" message={error} />}

      <Button
        type="submit"
        text={isSignUp ? "Create account" : "Sign in"}
        loadingText="Please wait…"
        loading={pending}
      />

      <p>
        <TextLink
          text={isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
          href={isSignUp ? "/sign-in" : "/sign-up"}
        />
      </p>
    </form>
  );
}
