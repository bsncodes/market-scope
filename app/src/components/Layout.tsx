import type { ReactNode } from 'react';

const STEPS = ['Upload portfolio', 'Define market', 'Discover', 'Dashboard'];

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
        <div className="shell__brand">MarketScope</div>
        <ol className="steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              className={
                index === step
                  ? 'steps__item steps__item--current'
                  : index < step
                    ? 'steps__item steps__item--done'
                    : 'steps__item'
              }
            >
              <span className="steps__index">{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </header>

      <main className="shell__main">
        <h1 className="shell__title">{title}</h1>
        {subtitle && <p className="shell__subtitle">{subtitle}</p>}
        {children}
      </main>
    </div>
  );
}
