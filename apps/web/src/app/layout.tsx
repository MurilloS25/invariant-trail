import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Invariant Trail',
  description:
    'A visual, deterministic failure simulator. Find the shortest sequence of retries, duplicates, crashes and races that breaks a safety rule in a stateful workflow.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

// A <meta> CSP is defense in depth: it cannot express frame-ancestors and the worker script's own
// headers govern the worker. A real header is a follow-up if the site is ever hosted (see ADR 0003).
// Everything is same-origin static files. The page never fetches anything on a visitor's behalf.
// Inline script/style are needed by the framework's hydration payload and React style props.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV === 'production' ? (
          <meta httpEquiv="Content-Security-Policy" content={CSP} />
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
