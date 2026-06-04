import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../components/data/EmptyState/index.js';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="no incidents" />);
    expect(screen.getByText('no incidents')).toBeInTheDocument();
  });

  it('renders description and action when provided', () => {
    render(
      <EmptyState
        title="x"
        description="all clear"
        action={<button type="button">create</button>}
      />,
    );
    expect(screen.getByText('all clear')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'create' })).toBeInTheDocument();
  });
});
