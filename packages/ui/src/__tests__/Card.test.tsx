import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card } from '../components/ui/Card/index.js';

describe('Card', () => {
  it('renders children', () => {
    render(<Card data-testid="c">content</Card>);
    expect(screen.getByTestId('c')).toHaveTextContent('content');
  });

  it('supports header / body / footer composition', () => {
    render(
      <Card>
        <Card.Header>head</Card.Header>
        <Card.Body>body</Card.Body>
        <Card.Footer>foot</Card.Footer>
      </Card>,
    );
    expect(screen.getByText('head')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('foot')).toBeInTheDocument();
  });
});
