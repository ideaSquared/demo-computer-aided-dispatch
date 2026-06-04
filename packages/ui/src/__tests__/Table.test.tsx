import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Table } from '../components/data/Table/index.js';

const columns = [
  { id: 'name', label: 'name', width: '1fr' },
  { id: 'status', label: 'status', width: '120px' },
];

describe('Table', () => {
  it('renders rows', () => {
    render(
      <Table
        columns={columns}
        rows={[
          { id: '1', cells: ['Alpha-1', 'available'] },
          { id: '2', cells: ['Bravo-2', 'dispatched'] },
        ]}
      />,
    );
    expect(screen.getByText('Alpha-1')).toBeInTheDocument();
    expect(screen.getByText('Bravo-2')).toBeInTheDocument();
  });

  it('shows empty state when there are no rows', () => {
    render(<Table columns={columns} rows={[]} empty="no units" />);
    expect(screen.getByText('no units')).toBeInTheDocument();
  });

  it('invokes onRowClick when an interactive row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <Table columns={columns} rows={[{ id: '42', cells: ['x', 'y'] }]} onRowClick={onRowClick} />,
    );
    screen.getAllByRole('row')[1]?.click();
    expect(onRowClick).toHaveBeenCalledWith('42');
  });
});
