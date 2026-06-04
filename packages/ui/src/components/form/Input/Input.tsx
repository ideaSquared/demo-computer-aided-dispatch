import type { InputHTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { type InputVariants, input } from './Input.css.js';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & InputVariants;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size, invalid, monospace, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[input({ size, invalid, monospace }), className].filter(Boolean).join(' ')}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
});
