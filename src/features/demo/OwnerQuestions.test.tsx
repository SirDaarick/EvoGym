import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OwnerQuestions } from './OwnerQuestions';

describe('contextual owner questions', () => {
  it('discloses only the requested questions and their non-final statuses', async () => {
    render(<OwnerQuestions ids={['Q-01', 'Q-10', 'Q-13']} />);
    const summary = screen.getByText('Para conversar con la dueña');
    expect(screen.getByText(/Q-01/)).not.toBeVisible();
    await userEvent.click(summary);
    expect(screen.getByText('Provisional')).toBeVisible();
    expect(screen.getByText('Por definir')).toBeVisible();
    expect(screen.getByText('Más adelante')).toBeVisible();
    expect(screen.queryByText(/Q-03/)).not.toBeInTheDocument();
  });
});
