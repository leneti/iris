'use client';

// globals.css is not loaded here, so the token values are written out.
export default function GlobalError(_props: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0b0710',
          color: '#f7eef6',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Something went wrong</h1>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            background: '#f25bd0',
            color: '#1a0716',
            border: 0,
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 16,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
