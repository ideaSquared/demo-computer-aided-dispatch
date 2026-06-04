import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from '../components/layout/Panel/index.js';

describe('Panel', () => {
  it('renders header, body, footer when provided', () => {
    render(
      <Panel header="HEAD" footer="FOOT">
        BODY
      </Panel>,
    );
    expect(screen.getByText('HEAD')).toBeInTheDocument();
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(screen.getByText('FOOT')).toBeInTheDocument();
  });

  it('forwards className', () => {
    render(
      <Panel className="extra" data-testid="p">
        body
      </Panel>,
    );
    expect(screen.getByTestId('p').className).toContain('extra');
  });
});
