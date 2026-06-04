import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Divider } from '../components/layout/Divider/index.js';

describe('Divider', () => {
  it('renders an hr with aria-orientation', () => {
    render(<Divider orientation="vertical" data-testid="d" />);
    const el = screen.getByTestId('d');
    expect(el.tagName).toBe('HR');
    expect(el).toHaveAttribute('aria-orientation', 'vertical');
  });
});
