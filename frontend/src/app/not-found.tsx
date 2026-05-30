import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-4 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-atlas-muted">
        We don&apos;t have data for that security yet.
      </p>
      <Link href="/" className="inline-block text-atlas-accent hover:underline">← Back to search</Link>
    </div>
  );
}
