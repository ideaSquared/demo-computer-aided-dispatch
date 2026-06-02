import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import type { StackVariants } from './Stack.css.js';
import { stack } from './Stack.css.js';

export type StackProps = HTMLAttributes<HTMLDivElement> &
  StackVariants & {
    children: ReactNode;
  };

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { direction, gap, align, justify, className, children, ...rest },
  ref,
) {
  const recipeClass = stack({ direction, gap, align, justify });
  return (
    <div ref={ref} className={[recipeClass, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
});
