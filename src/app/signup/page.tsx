import { AuthCard } from "@/components/auth-card";
import { SignupForm } from "@/features/auth/signup-form";

export const metadata = { title: "Sign up — Facturio" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Start managing clients and invoices in minutes."
    >
      <SignupForm />
    </AuthCard>
  );
}
