import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../components/ui/Button/index.js';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Dispatch</Button>);
    expect(screen.getByRole('button', { name: /dispatch/i })).toBeInTheDocument();
  });

  it('invokes onClick when activated', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Button disabled>Wait</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
