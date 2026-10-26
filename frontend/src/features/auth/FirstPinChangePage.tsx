import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Field } from '../../shared/ui';
import { ProfileEntryLayout } from '../staff/ProfileEntryLayout';
import {
  StaffCredentialsApiError,
  StaffCredentialsConfigurationError,
  submitFirstPinChange,
} from '../../api/staffCredentialsApi';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface FirstPinChangePageProps {
  apiOrigin?: string;
  fetchImpl?: typeof fetch;
}

function safeFailure(error: unknown): string {
  if (error instanceof StaffCredentialsConfigurationError) return error.message;
  if (error instanceof StaffCredentialsApiError && error.status === 429) return error.message;
  if (error instanceof StaffCredentialsApiError && error.status === 401) return error.message;
  if (error instanceof StaffCredentialsApiError && error.status === 413) return 'The submitted information is too large. Check the fields and try again.';
  return 'The PIN could not be changed. Check your connection and try again.';
}

export function FirstPinChangePage({ apiOrigin, fetchImpl }: FirstPinChangePageProps) {
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get('branch_id') ?? '';
  const branchIsValid = UUID_PATTERN.test(branchId);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [messageBranchId, setMessageBranchId] = useState(branchId);
  const branchContext = useRef({ branchId, generation: 0 });
  const mounted = useRef(false);
  const submitInFlight = useRef(false);
  const submitGeneration = useRef(0);

  useLayoutEffect(() => {
    branchContext.current = { branchId, generation: branchContext.current.generation + 1 };
    setCurrentPin(''); setNewPin(''); setConfirmation('');
    setMessage(''); setSuccess(false);
    setMessageBranchId(branchId);
  }, [branchId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function report(messageText: string, isSuccess = false) {
    setMessage(messageText);
    setSuccess(isSuccess);
    setMessageBranchId(branchId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!branchIsValid || submitting || submitInFlight.current) return;
    report('');
    if (!loginIdentifier.trim() || !/^\d{6}$/.test(currentPin) || !/^\d{6}$/.test(newPin)) {
      report('Enter your login identifier and six-digit current and new PINs.');
      return;
    }
    if (currentPin === newPin) {
      report('Choose a new PIN that is different from your current PIN.');
      return;
    }
    if (newPin !== confirmation) {
      report('The new PIN and confirmation do not match.');
      return;
    }
    const submitted = { loginIdentifier: loginIdentifier.trim(), branchId, currentPin, newPin };
    const submittedContext = branchContext.current;
    const thisSubmit = ++submitGeneration.current;
    submitInFlight.current = true;
    setSubmitting(true);
    try {
      await submitFirstPinChange(submitted, { apiOrigin, fetchImpl });
      if (!mounted.current || branchContext.current !== submittedContext) return;
      report('Your PIN was changed. You can now sign in with your new PIN.', true);
    } catch (error) {
      if (!mounted.current || branchContext.current !== submittedContext) return;
      report(safeFailure(error));
    } finally {
      if (mounted.current && submitGeneration.current === thisSubmit) {
        submitInFlight.current = false;
        if (branchContext.current === submittedContext) {
          setCurrentPin(''); setNewPin(''); setConfirmation('');
        }
        setSubmitting(false);
      }
    }
  }

  return <ProfileEntryLayout>
    <main className="staff-selection-main" id="main-content" tabIndex={-1} aria-labelledby="first-pin-title">
      <div className="staff-selection-heading">
        <h1 id="first-pin-title">Change your initial PIN</h1>
        {branchIsValid ? <>
          <p className="muted">This page uses the branch context supplied by your administrator. It does not grant access by itself.</p>
          <p className="muted">Your temporary PIN expires after 7 days. Change it before signing in to employee services.</p>
          <form className="staff-access-panel" onSubmit={event => void submit(event)}>
            <Field label="Login identifier" id="first-pin-login" name="login_identifier" autoComplete="username" required
              value={loginIdentifier} onChange={event => setLoginIdentifier(event.target.value)} disabled={submitting} />
            <Field label="Temporary current PIN" id="first-pin-current" name="current_pin" type="password" inputMode="numeric" autoComplete="off"
              pattern="[0-9]{6}" maxLength={6} required value={currentPin} onChange={event => setCurrentPin(event.target.value)} disabled={submitting} />
            <Field label="New six-digit PIN" id="first-pin-new" name="new_pin" type="password" inputMode="numeric" autoComplete="new-password"
              pattern="[0-9]{6}" maxLength={6} required value={newPin} onChange={event => setNewPin(event.target.value)} disabled={submitting} />
            <Field label="Confirm new PIN" id="first-pin-confirm" name="pin_confirmation" type="password" inputMode="numeric" autoComplete="new-password"
              pattern="[0-9]{6}" maxLength={6} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={submitting} />
            <Button variant="primary" type="submit" disabled={submitting}>{submitting ? 'Changing PIN…' : 'Change PIN'}</Button>
          </form>
          {message && messageBranchId === branchId && <p role={success ? 'status' : 'alert'}>{message}</p>}
        </> : <p role="alert">This link is missing valid branch context. Ask your administrator for a new branch-specific link.</p>}
      </div>
    </main>
  </ProfileEntryLayout>;
}
