import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

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
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <div className="brand">
              <Link href="/" className="wordmark">
                starling<span className="wordmark-dot">.</span>
              </Link>
              <a
                className="poweredby"
                href="https://lectr.bid"
                target="_blank"
                rel="noopener noreferrer"
              >
                powered by lectr
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
          {/* Persistent, unavoidable affiliate disclosure (PROPOSAL §5.6.3). */}
          <p className="disclosure-bar">
            Some links to eBay are affiliate links: Starling may earn a commission if you buy,
            at no additional cost to you. Prices and value estimates are informational, not offers.
          </p>
        </header>

        <main className="main">{children}</main>

        <footer className="footer">
          <div className="footer-inner">
            <div className="footer-brand">
              <span className="wordmark small">starling<span className="wordmark-dot">.</span></span>
              <a href="https://lectr.bid" target="_blank" rel="noopener noreferrer" className="poweredby">
                powered by lectr
              </a>
            </div>
            <nav className="footer-nav" aria-label="Footer">
              <Link href="/">Board</Link>
              <Link href="/tape/">The Tape</Link>
              <Link href="/about/">About</Link>
              <a href="https://lectr.bid" target="_blank" rel="noopener noreferrer">
                lectr.bid
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
