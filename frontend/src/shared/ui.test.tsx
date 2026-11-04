import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field, FormField, focusFirstInvalid, useFieldErrors } from './ui';

describe('Field / FormField', () => {
  it('Field links aria-invalid and the error text', () => {
    render(<Field id="a" label="Alfa" error="Falta alfa" />);
    expect(screen.getByLabelText('Alfa')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Alfa')).toHaveAccessibleDescription('Falta alfa');
  });

  it('FormField wires any control (select, textarea) to its error', () => {
    render(<>
      <FormField id="s" label="Sel" error="Elige uno"><select><option value="">-</option></select></FormField>
      <FormField id="t" label="Txt"><textarea aria-describedby="hint" /></FormField>
      <span id="hint">pista</span>
    </>);
    const select = screen.getByLabelText('Sel');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('Elige uno');
    expect(screen.getByLabelText('Txt')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Txt')).toHaveAccessibleDescription('pista');
  });

  it('useFieldErrors clears a field and focusFirstInvalid focuses it', async () => {
    function Demo() {
      const { errors, setErrors, clear } = useFieldErrors();
      return <form noValidate onSubmit={e => { e.preventDefault(); setErrors({ x: 'Requerido' }); focusFirstInvalid([false, 'x']); }}>
        <FormField id="x" label="Equis" error={errors.x}><input onChange={() => clear('x')} /></FormField>
        <button type="submit">Ir</button>
      </form>;
    }
    render(<Demo />);
    await userEvent.click(screen.getByRole('button', { name: 'Ir' }));
    expect(screen.getByLabelText('Equis')).toHaveFocus();
    expect(screen.getByText('Requerido')).toBeVisible();
    await userEvent.type(screen.getByLabelText('Equis'), 'a');
    expect(screen.queryByText('Requerido')).toBeNull();
  });
});
