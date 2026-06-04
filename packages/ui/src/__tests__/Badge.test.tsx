import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from '../components/ui/Badge/index.js';

describe('Badge', () => {
  it('renders neutral children', () => {
    render(<Badge data-testid="b">draft</Badge>);
    expect(screen.getByTestId('b')).toHaveTextContent('draft');
  });

  it('applies a class for tier discriminant', () => {
    render(
      <Badge tone="tier" value="police" data-testid="b">
        police
      </Badge>,
    );
    expect(screen.getByTestId('b').className).not.toBe('');
  });

  it('applies a class for severity discriminant', () => {
    render(
      <Badge tone="severity" value="s4" variant="soft" data-testid="b">
        high
      </Badge>,
    );
    expect(screen.getByTestId('b').className).not.toBe('');
  });

  it('forwards className', () => {
    render(
      <Badge className="extra" data-testid="b">
        x
      </Badge>,
    );
    expect(screen.getByTestId('b').className).toContain('extra');
  });
});
