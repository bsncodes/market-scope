import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

// Only the flow is listed. The dashboard is the home page and the brand link
// already leads there, so giving it a step of its own said the same thing
// twice. None of these are links: jumping into the middle of the flow is not
// a meaningful action.
const STEPS = ['Upload portfolio', 'Define market', 'Discover'];

/** `step` is 1..3 inside the flow, or 0 on the dashboard, where none is current. */
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
            const position = index + 1;
            const className =
              position === step
                ? 'steps__item steps__item--current'
                : position < step
                  ? 'steps__item steps__item--done'
                  : 'steps__item';

            return (
              <li key={label} className={className}>
                <span className="steps__index">{position}</span>
                {label}
              </li>
            );
          })}
        </ol>

        <nav className="shell__nav">
          <NavLink to="/portfolio" end className="shell__navlink">
            Portfolio
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
