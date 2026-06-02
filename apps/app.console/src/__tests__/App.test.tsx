import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    // jsdom has WebSocket only via newer versions; stub it so unauth render works.
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it('renders the identity-stub message when no ?operator is set', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /operator console/i })).toBeInTheDocument();
    expect(screen.getByText(/\?operator=/)).toBeInTheDocument();
  });
});
