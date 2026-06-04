import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { type DividerVariants, divider } from './Divider.css.js';

export type DividerProps = Omit<HTMLAttributes<HTMLHRElement>, 'children'> & DividerVariants;

export const Divider = forwardRef<HTMLHRElement, DividerProps>(function Divider(
  { orientation, tone, className, ...rest },
  ref,
) {
  return (
    <hr
      ref={ref}
      aria-orientation={orientation ?? 'horizontal'}
      className={[divider({ orientation, tone }), className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
});
