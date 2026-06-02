import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import type { ButtonVariants } from './Button.css.js';
import { button } from './Button.css.js';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> &
  ButtonVariants & {
    children: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { intent, size, className, children, type = 'button', ...rest },
  ref,
) {
  const recipeClass = button({ intent, size });
  return (
    <button
      ref={ref}
      type={type}
      className={[recipeClass, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});
