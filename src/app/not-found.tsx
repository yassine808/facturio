import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">404 — page not found</h1>
      <Link href="/" className="text-sm underline">
        Back home
      </Link>
    </main>
  );
}
