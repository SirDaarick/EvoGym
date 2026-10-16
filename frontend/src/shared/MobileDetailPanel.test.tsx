import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MobileDetailPanel } from './MobileDetailPanel';

describe('MobileDetailPanel', () => {
  it('opens from a visible trigger and closes with focus restoration', async () => {
    render(<MobileDetailPanel title="Details" triggerLabel="View details"><button>Confirm</button></MobileDetailPanel>);
    const trigger = document.querySelector<HTMLButtonElement>('.mobile-detail-trigger')!;
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeVisible();
    const close = document.querySelector<HTMLButtonElement>('.mobile-detail-close')!;
    expect(close).toHaveFocus();
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(document.querySelector('.mobile-detail-backdrop')!);
    expect(trigger).toHaveFocus();
  });

  it('opens from a safe left swipe inside the detail surface', () => {
    render(<MobileDetailPanel title="Details" triggerLabel="View details"><button>Confirm</button></MobileDetailPanel>);
    const surface = document.querySelector('.mobile-detail-panel')!;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    fireEvent.touchStart(surface, { touches: [{ clientX: 350, clientY: 200 }] });
    fireEvent.touchEnd(surface, { touches: [], changedTouches: [{ clientX: 240, clientY: 202 }] });
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeVisible();
  });
});
