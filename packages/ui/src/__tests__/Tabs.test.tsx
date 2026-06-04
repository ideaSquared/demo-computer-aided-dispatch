import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '../components/navigation/Tabs/index.js';

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

describe('Tabs', () => {
  it('renders all items as tabs', () => {
    render(<Tabs value="a" onChange={() => {}} items={items} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active tab as selected', () => {
    render(<Tabs value="b" onChange={() => {}} items={items} />);
    expect(screen.getByRole('tab', { name: /bravo/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /alpha/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('invokes onChange on click', () => {
    const onChange = vi.fn();
    render(<Tabs value="a" onChange={onChange} items={items} />);
    screen.getByRole('tab', { name: /charlie/i }).click();
    expect(onChange).toHaveBeenCalledWith('c');
  });
});
