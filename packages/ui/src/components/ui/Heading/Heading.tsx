import type { HTMLAttributes, ReactNode } from 'react';
import { createElement, forwardRef } from 'react';
import type { HeadingVariants } from './Heading.css.js';
import { heading } from './Heading.css.js';

type HeadingLevel = 1 | 2 | 3 | 4;

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> &
  HeadingVariants & {
    level: HeadingLevel;
    children: ReactNode;
  };

const defaultSizeForLevel: Record<HeadingLevel, NonNullable<HeadingVariants['size']>> = {
  1: 'lg',
  2: 'md',
  3: 'sm',
  4: 'xs',
};

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(function Heading(
  { level, size, tone, className, children, ...rest },
  ref,
) {
  const recipeClass = heading({ size: size ?? defaultSizeForLevel[level], tone });
  return createElement(
    `h${level}`,
    {
      ref,
      className: [recipeClass, className].filter(Boolean).join(' '),
      ...rest,
    },
    children,
  );
});
