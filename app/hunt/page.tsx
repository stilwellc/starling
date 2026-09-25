import type { Metadata } from 'next';

export const dynamic = 'force-static';

/** Grails moved into the hunt engine (Sep 25 2026). Old links forward to the grails section of the Hunt view. */
export const metadata: Metadata = {
  title: 'Grails moved · Starling',
  robots: { index: false },
};

export default function GrailsMoved() {
  return (
    <main className="page">
      <meta httpEquiv="refresh" content="0; url=/#hunts-grails" />
      <p>
        The grails are now part of the hunt list. <a href="/#hunts-grails">See them on the Hunts page →</a>
      </p>
    </main>
  );
}
