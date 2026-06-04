import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { error as errorStyle, field, hint as hintStyle, label as labelStyle } from './Field.css.js';

export type FieldProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
};

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, htmlFor, hint, error, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={[field, className].filter(Boolean).join(' ')} {...rest}>
      <label className={labelStyle} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className={errorStyle}>{error}</div>
      ) : hint ? (
        <div className={hintStyle}>{hint}</div>
      ) : null}
    </div>
  );
});
