import { AppShell } from "@/components/layouts/app-shell";
import { AuthForm } from "@/features/auth/auth-form";

export default function SignUpPage() {
  return (
    <AppShell title="Create account">
      <AuthForm mode="sign-up" />
    </AppShell>
  );
}
