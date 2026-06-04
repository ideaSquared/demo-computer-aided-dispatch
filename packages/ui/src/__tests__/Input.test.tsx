import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input } from '../components/form/Input/index.js';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="callsign" />);
    expect(screen.getByPlaceholderText('callsign')).toBeInTheDocument();
  });

  it('reflects invalid via aria-invalid', () => {
    render(<Input invalid data-testid="i" />);
    expect(screen.getByTestId('i')).toHaveAttribute('aria-invalid', 'true');
  });

  it('forwards onChange', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} data-testid="i" />);
    fireEvent.change(screen.getByTestId('i'), { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalled();
  });
});
