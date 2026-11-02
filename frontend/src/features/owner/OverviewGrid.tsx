import type { ReactNode } from 'react';

export function OverviewGrid({ children }: { children: ReactNode }) {
  return <div className="bento-grid mt-6">{children}</div>;
}
