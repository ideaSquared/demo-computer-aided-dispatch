import type { SelectHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { type SelectVariants, select } from './Select.css.js';

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & SelectVariants;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size, invalid, monospace, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={[select({ size, invalid, monospace }), className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
});
