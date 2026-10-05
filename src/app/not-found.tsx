import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl font-black">404</p>
        <p className="mt-2 text-mute">this page doesn&apos;t exist. unlike your backlog.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-hot px-5 py-2.5 text-sm font-bold text-ink">
          back home
        </Link>
      </div>
    </main>
  );
}
