'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: '#0d0d14', color: '#fff', padding: 24, fontFamily: 'monospace' }}>
        <h2>Debug: client exception</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          message: {error.message}
          {'\n'}digest: {error.digest}
          {'\n'}stack: {error.stack}
        </pre>
        <button onClick={() => reset()} style={{ marginTop: 12, padding: '8px 16px' }}>
          Try again
        </button>
      </body>
    </html>
  );
}
