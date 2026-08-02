import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

const STEPS = ['Upload portfolio', 'Define market', 'Discover', 'Dashboard'];

// The first two steps are reachable at any time: re-uploading a portfolio and
// starting another market are both things you do repeatedly, not once. The
// last two belong to a specific market, so they are only ever a label.
const STEP_LINKS: (string | null)[] = ['/', '/setup', null, null];

export function Layout({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="shell__header">
        <Link className="shell__brand" to="/">
          MarketScope
        </Link>

        <ol className="steps">
          {STEPS.map((label, index) => {
            const className =
              index === step
                ? 'steps__item steps__item--current'
                : index < step
                  ? 'steps__item steps__item--done'
                  : 'steps__item';
            const href = STEP_LINKS[index];

            return (
              <li key={label} className={className}>
                <span className="steps__index">{index + 1}</span>
                {href ? (
                  <Link className="steps__link" to={href}>
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ol>

        <nav className="shell__nav">
          <NavLink to="/" end className="shell__navlink">
            Portfolio
          </NavLink>
          <NavLink to="/markets" end className="shell__navlink">
            Markets
          </NavLink>
        </nav>
      </header>

      <main className="shell__main">
        <h1 className="shell__title">{title}</h1>
        {subtitle && <p className="shell__subtitle">{subtitle}</p>}
        {children}
      </main>
    </div>
  );
}
