import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from '../components/ui/StatusDot/index.js';

describe('StatusDot', () => {
  it('renders an aria-hidden span', () => {
    render(<StatusDot data-testid="d" />);
    expect(screen.getByTestId('d')).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies a class for unit-status discriminant', () => {
    render(<StatusDot tone="unitStatus" value="enRoute" data-testid="d" />);
    expect(screen.getByTestId('d').className).not.toBe('');
  });

  it('renders pulse variant', () => {
    render(<StatusDot tone="connection" value="connecting" pulse data-testid="d" />);
    expect(screen.getByTestId('d').className.length).toBeGreaterThan(0);
  });
});
