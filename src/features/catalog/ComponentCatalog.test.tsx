import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ComponentCatalog } from './ComponentCatalog';

describe('shared component catalog foundation', () => {
  afterEach(() => { delete document.documentElement.dataset.theme; });

  it('exposes keyboard-operable tab navigation and applies reduced-motion guidance', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/reducen movimiento/i)).toBeVisible();
  });

  it('provides a direct, accessible light and dark theme control', () => {
    render(<MemoryRouter><ComponentCatalog /></MemoryRouter>);
    const control = screen.getByRole('button', { name: 'Usar tema oscuro' });
    fireEvent.click(control);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toHaveAttribute('aria-pressed', 'true');
  });
});
