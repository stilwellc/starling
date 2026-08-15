import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter, Fraunces, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// lectr's three faces: Inter (UI + tabular numerals), Fraunces (the museum-voice
// display serif — one italic butter accent word), IBM Plex Mono (terminal data).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif-display',
  display: 'swap',
  style: ['normal', 'italic'],
  axes: ['opsz', 'SOFT', 'WONK'],
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-data',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Starling — deep-value deals, powered by lectr',
  description:
    "Starling points lectr's certified price corpus at eBay Buy It Now and surfaces listings sitting deep under what they're actually worth — every deal shown with its evidence and an A–D risk grade.",
  metadataBase: new URL('https://starling.bid'),
  openGraph: {
    title: 'Starling — deep-value deals, powered by lectr',
    description:
      "Live Buy It Now listings priced deep under lectr's corpus value, risk-graded and evidence-backed.",
    siteName: 'Starling',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const NAV = [
  { href: '/', label: 'Board' },
  { href: '/tape/', label: 'The Tape' },
  { href: '/about/', label: 'About' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${fraunces.variable} ${plexMono.variable}`}
    >
      <body>
        <div className="bg-field" aria-hidden="true" />

        <header className="masthead">
          <div className="masthead-inner rail">
            <div className="brand">
              <Link href="/" className="wordmark">
                starling<span className="wordmark-dot">.</span>
              </Link>
              <a
                className="poweredby"
                href="https://lectr.bid"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="powered by lectr"
              >
                <span className="poweredby-label">powered by</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="lectr-mark" src="/brand/lectr-nav.png" alt="lectr" />
              </a>
            </div>
            <nav className="nav" aria-label="Primary">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="nav-link">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          {/* Persistent, unavoidable affiliate + preview disclosure. */}
          <div className="disclosure-bar rail">
            <span className="disclosure-tag">Preview</span>
            <span>
              Sample data — not live eBay deals yet. Some eBay links are affiliate links; Starling may
              earn a commission at no additional cost to you. Values are informational, not offers.
            </span>
          </div>
        </header>

        <main className="main rail">{children}</main>

        <footer className="footer">
          <div className="footer-inner rail">
            <div className="footer-brand">
              <span className="wordmark small">
                starling<span className="wordmark-dot">.</span>
              </span>
              <a
                href="https://lectr.bid"
                target="_blank"
                rel="noopener noreferrer"
                className="poweredby"
                aria-label="powered by lectr"
              >
                <span className="poweredby-label">powered by</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="lectr-mark" src="/brand/lectr-nav.png" alt="lectr" />
              </a>
            </div>
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/">Board</Link>
              <Link href="/tape/">The Tape</Link>
              <Link href="/about/">About</Link>
              <a href="https://lectr.bid" target="_blank" rel="noopener noreferrer">
                lectr.bid ↗
              </a>
            </nav>
            <p className="footer-fine">
              Starling consumes lectr&apos;s price corpus; it holds no corpus of its own and
              manufactures no numbers. eBay is a trademark of eBay Inc.; Starling is an independent
              affiliate and is not endorsed by eBay. Listing data is removed from the board once a
              listing is no longer available.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
