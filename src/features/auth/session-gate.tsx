"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TextLink } from "@/components/ui/text-link";
import { ErrorState } from "@/components/patterns/error-state";
import { authClient } from "@/lib/auth-client";

export type SessionGateProps = {
  /** Plural noun used in the signed-out prompt, e.g. "projects". */
  resourceLabel: string;
  /** Must be plain elements: server pages cannot pass functions to this client component. */
  children: ReactNode;
};

/** Renders children only for a signed-in user, with a sign-out control. */
export function SessionGate({ resourceLabel, children }: SessionGateProps) {
  const { data: session, isPending, error } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError(result.error.message ?? "Could not sign out.");
        return;
      }
      window.location.replace("/sign-in");
    } catch {
      setSignOutError("Could not connect. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (isPending) {
    return (
      <p role="status">
        <Spinner decorative /> Checking your session…
      </p>
    );
  }

  if (error) {
    return (
      <ErrorState
        message="Could not check your session."
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!session) {
    return (
      <p>
        <TextLink text="Sign in" href="/sign-in" /> to view your {resourceLabel}.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>Signed in as {session.user.email}</p>
        <Button
          text="Sign out"
          loadingText="Signing out…"
          variant="ghost"
          loading={signingOut}
          onClick={signOut}
        />
      </div>

      {signOutError && <p role="alert">{signOutError}</p>}

      <div key={session.user.id}>{children}</div>
    </div>
  );
}
