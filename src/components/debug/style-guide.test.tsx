import { render, screen } from '@testing-library/react';
import { StyleGuide } from './style-guide';
import { describe, it, expect } from 'vitest';

describe('StyleGuide', () => {
  it('renders the design system audit header', () => {
    render(<StyleGuide />);
    expect(screen.getByText('Design System Audit')).toBeInTheDocument();
  });

  it('renders color palette section', () => {
    render(<StyleGuide />);
    expect(screen.getByText('Color Palette')).toBeInTheDocument();
  });

  it('renders typography section', () => {
    render(<StyleGuide />);
    expect(screen.getByText('Typography')).toBeInTheDocument();
  });

  it('renders buttons section', () => {
    render(<StyleGuide />);
    expect(screen.getByText('Buttons')).toBeInTheDocument();
  });
});
