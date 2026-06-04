import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import {
  bodyCell,
  bodyRow,
  empty,
  headerCell,
  tableGrid,
  tableRoot,
  tableScroll,
} from './Table.css.js';

type Align = 'start' | 'center' | 'end';

export type TableColumn = {
  id: string;
  label: ReactNode;
  /** CSS grid track size, e.g. '1fr', 'minmax(120px, 1fr)', '160px'. */
  width?: string;
  align?: Align;
};

export type TableRow = {
  id: string;
  cells: ReadonlyArray<ReactNode>;
};

export type TableProps = HTMLAttributes<HTMLDivElement> & {
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  density?: 'comfortable' | 'compact';
  empty?: ReactNode;
  onRowClick?: (id: string) => void;
  caption?: ReactNode;
};

export const Table = forwardRef<HTMLDivElement, TableProps>(function Table(
  {
    columns,
    rows,
    density = 'compact',
    empty: emptyContent,
    onRowClick,
    caption,
    className,
    ...rest
  },
  ref,
) {
  const gridTemplate = columns.map((c) => c.width ?? '1fr').join(' ');

  if (rows.length === 0) {
    return (
      <div ref={ref} className={[tableRoot, className].filter(Boolean).join(' ')} {...rest}>
        <div className={empty}>{emptyContent ?? 'no rows'}</div>
      </div>
    );
  }

  return (
    <div ref={ref} className={[tableRoot, className].filter(Boolean).join(' ')} {...rest}>
      <div className={tableScroll}>
        <table className={tableGrid} style={{ gridTemplateColumns: gridTemplate }}>
          {typeof caption === 'string' || caption ? (
            <caption style={{ display: 'none' }}>{caption}</caption>
          ) : null}
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.id} scope="col" className={headerCell({ align: col.align })}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const interactive = Boolean(onRowClick);
              const handleClick = () => {
                if (onRowClick) onRowClick(row.id);
              };
              return (
                <tr
                  key={row.id}
                  className={bodyRow({ interactive })}
                  onClick={interactive ? handleClick : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleClick();
                          }
                        }
                      : undefined
                  }
                  tabIndex={interactive ? 0 : undefined}
                >
                  {row.cells.map((cell, idx) => {
                    const col = columns[idx];
                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: row + column-index pair is stable for this render
                        key={`${row.id}-${idx}`}
                        className={bodyCell({ density, align: col?.align })}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
