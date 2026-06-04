import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { type PageShellVariants, pageShell } from './PageShell.css.js';

export type PageShellProps = HTMLAttributes<HTMLElement> &
  PageShellVariants & {
    children: ReactNode;
  };

export const PageShell = forwardRef<HTMLElement, PageShellProps>(function PageShell(
  { maxWidth, className, children, ...rest },
  ref,
) {
  return (
    <main
      ref={ref}
      className={[pageShell({ maxWidth }), className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </main>
  );
});
