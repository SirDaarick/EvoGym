import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../../demo/DemoProvider';
import { Sales } from './Sales';

describe('sales product guidance', () => {
  it('renders sales operational guidance without demo framing', () => {
    render(
      <MemoryRouter>
        <DemoProvider>
          <Sales role="OWNER" />
        </DemoProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Venta de productos y visitas' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Información de venta' })).toBeVisible();
    expect(screen.getByText(/Tarifas de visita:/i)).toBeVisible();
    expect(screen.queryByText(/producto ilustrativo/i)).not.toBeInTheDocument();
  });
});
