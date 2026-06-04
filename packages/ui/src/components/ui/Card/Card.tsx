import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import type { CardVariants } from './Card.css.js';
import { card, cardBody, cardFooter, cardHeader } from './Card.css.js';

export type CardProps = HTMLAttributes<HTMLDivElement> &
  CardVariants & {
    children: ReactNode;
  };

const CardRoot = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone, padding, bordered, interactive, className, children, ...rest },
  ref,
) {
  const recipeClass = card({ tone, padding, bordered, interactive });
  return (
    <div ref={ref} className={[recipeClass, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
});

function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[cardHeader, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[cardBody, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[cardFooter, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});
