import type { ReactNode } from "react";

/** Centered card used by all auth pages. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}
        <div className="mt-6">{children}</div>
        {footer && (
          <div className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">{footer}</div>
        )}
      </div>
    </main>
  );
}
