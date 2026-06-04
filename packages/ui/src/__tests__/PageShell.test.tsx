import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from '../components/layout/PageShell/index.js';

describe('PageShell', () => {
  it('renders a main element', () => {
    render(<PageShell data-testid="s">content</PageShell>);
    expect(screen.getByTestId('s').tagName).toBe('MAIN');
  });

  it('applies maxWidth variant', () => {
    render(
      <PageShell maxWidth="responder" data-testid="s">
        content
      </PageShell>,
    );
    expect(screen.getByTestId('s').className.length).toBeGreaterThan(0);
  });
});
