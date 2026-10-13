import { AuthCard } from "@/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata = { title: "Reset password — Facturio" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="We'll email you a link to set a new one."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
