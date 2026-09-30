"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Deliberately generic: never render server error details (which may include data) to the page.
  return (
    <div className="py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">The error has been logged on the server.</p>
      <button onClick={reset} className="mt-4 text-sm font-medium text-accent hover:underline">Try again</button>
    </div>
  );
}
