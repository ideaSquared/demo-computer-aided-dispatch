import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Heading } from '../components/ui/Heading/index.js';

describe('Heading', () => {
  it('renders the requested heading level', () => {
    render(
      <Heading level={2} data-testid="h">
        Dispatch
      </Heading>,
    );
    const el = screen.getByTestId('h');
    expect(el.tagName).toBe('H2');
  });

  it('forwards className', () => {
    render(
      <Heading level={1} className="custom" data-testid="h">
        Title
      </Heading>,
    );
    expect(screen.getByTestId('h').className).toContain('custom');
  });

  it('applies a recipe class when size is specified', () => {
    render(
      <Heading level={3} size="metric" data-testid="h">
        42
      </Heading>,
    );
    // Vanilla-extract emits hashed class names; just assert one is present.
    expect(screen.getByTestId('h').className.length).toBeGreaterThan(0);
  });
});
