import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from '../components/form/Field/index.js';
import { Input } from '../components/form/Input/index.js';

describe('Field', () => {
  it('renders label and child input', () => {
    render(
      <Field label="callsign" htmlFor="cs">
        <Input id="cs" />
      </Field>,
    );
    expect(screen.getByText('callsign')).toBeInTheDocument();
    expect(screen.getByLabelText('callsign')).toBeInTheDocument();
  });

  it('renders error text when error prop is given', () => {
    render(
      <Field label="x" error="required">
        <Input />
      </Field>,
    );
    expect(screen.getByText('required')).toBeInTheDocument();
  });

  it('renders hint when only hint is given', () => {
    render(
      <Field label="x" hint="up to 8 chars">
        <Input />
      </Field>,
    );
    expect(screen.getByText('up to 8 chars')).toBeInTheDocument();
  });
});
