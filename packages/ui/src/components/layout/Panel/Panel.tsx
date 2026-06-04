import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import {
  type PanelBodyVariants,
  type PanelVariants,
  panel,
  panelBody,
  panelFooter,
  panelHeader,
} from './Panel.css.js';

export type PanelProps = HTMLAttributes<HTMLElement> &
  PanelVariants & {
    header?: ReactNode;
    footer?: ReactNode;
    bodyPadding?: PanelBodyVariants['padding'];
    children: ReactNode;
  };

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { tone, header, footer, bodyPadding, className, children, ...rest },
  ref,
) {
  const recipeClass = panel({ tone });
  return (
    <section ref={ref} className={[recipeClass, className].filter(Boolean).join(' ')} {...rest}>
      {header ? <div className={panelHeader}>{header}</div> : null}
      <div className={panelBody({ padding: bodyPadding })}>{children}</div>
      {footer ? <div className={panelFooter}>{footer}</div> : null}
    </section>
  );
});
