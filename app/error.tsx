'use client';

export default function ErrorPage(_props: { error: Error & { digest?: string } }) {
  return (
    <main className="bg-bg text-text flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="font-display text-xl">Something went wrong</h1>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="bg-pink text-on-pink rounded-md px-4 py-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-pink-soft focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Reload
      </button>
    </main>
  );
}
