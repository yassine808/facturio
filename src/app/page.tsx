import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">Facturio</span>
        <nav className="flex gap-3 text-sm">
          <Link
            href="/login"
            className="rounded-md px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-3 py-2 text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Invoicing for freelancers and small teams
        </h1>
        <p className="mt-4 max-w-xl text-balance text-zinc-600 dark:text-zinc-400">
          Manage clients, send professional invoices, track payments — all under one
          organization account with your teammates.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-zinc-50 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Log in
          </Link>
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Portfolio project — not a real invoicing service.
      </footer>
    </div>
  );
}
