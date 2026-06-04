import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { emptyAction, emptyDescription, emptyState, emptyTitle } from './EmptyState.css.js';

export type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { title, description, action, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={[emptyState, className].filter(Boolean).join(' ')} {...rest}>
      <div className={emptyTitle}>{title}</div>
      {description ? <div className={emptyDescription}>{description}</div> : null}
      {action ? <div className={emptyAction}>{action}</div> : null}
    </div>
  );
});
