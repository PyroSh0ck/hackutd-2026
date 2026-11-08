import { AppShell } from "@/components/layouts/app-shell";
import { AuthForm } from "@/features/auth/auth-form";

export default function SignInPage() {
  return (
    <AppShell title="Sign in">
      <AuthForm mode="sign-in" />
    </AppShell>
  );
}
