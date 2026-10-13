import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "@/features/auth/login-form";

export const metadata = { title: "Log in — Facturio" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const { next, error, reset } = await searchParams;

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your Facturio workspace."
      footer={
        <>
          No account?{" "}
          <Link
            href="/signup"
            className="font-medium text-zinc-800 underline dark:text-zinc-200"
          >
            Sign up
          </Link>
        </>
      }
    >
      <LoginForm next={next} urlError={error} resetDone={reset === "1"} />
    </AuthCard>
  );
}
