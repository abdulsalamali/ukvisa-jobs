import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SponsorBoard — UK jobs at licensed visa sponsors",
  description:
    "Graduate, internship and experienced-hire jobs from employers on the Home Office register of licensed sponsors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">SB</span>
              SponsorBoard
            </Link>
            <nav className="nav">
              <Link href="/jobs">Jobs</Link>
              <Link href="/jobs?sort=relevance&minRelevance=40">For you</Link>
              <Link href="/sponsors">Sponsors</Link>
            </nav>
          </div>
        </header>

        <main className="page">{children}</main>

        <footer className="footer">
          <div className="container">
            <p>
              Sponsor data contains public sector information licensed under the{" "}
              <a
                href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Government Licence v3.0
              </a>
              . Source: Home Office, <em>Register of licensed sponsors: workers</em>, updated
              daily on GOV.UK.
            </p>
            <p>
              Job listings link to the employer&apos;s own posting and are shown for personal
              research only. A sponsor licence means an employer <em>may</em> sponsor; it does
              not guarantee that any given role qualifies. This site is information, not
              immigration advice — confirm current rules on{" "}
              <a href="https://www.gov.uk/skilled-worker-visa" target="_blank" rel="noopener noreferrer">
                GOV.UK
              </a>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
