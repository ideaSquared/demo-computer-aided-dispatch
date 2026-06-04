import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { tab, tabIcon, tablist } from './Tabs.css.js';

export type TabItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type TabsProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  onChange: (value: string) => void;
  items: ReadonlyArray<TabItem>;
  orientation?: 'horizontal' | 'vertical';
  ariaLabel?: string;
};

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { value, onChange, items, orientation = 'horizontal', ariaLabel, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      className={[tablist({ orientation }), className].filter(Boolean).join(' ')}
      {...rest}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`tabpanel-${item.id}`}
            id={`tab-${item.id}`}
            disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            className={tab({ orientation, active })}
            onClick={() => onChange(item.id)}
          >
            {item.icon ? <span className={tabIcon}>{item.icon}</span> : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
});
