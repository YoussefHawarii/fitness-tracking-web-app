import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { verifyOtp, resendOtp } from '../services/authService';
import { Card } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login: setSession } = useAuth();
  const email = (location.state as { email?: string } | null)?.email;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCooldown((seconds) => {
        if (seconds <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
  }

  if (!email) {
    return <Navigate to="/signup" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const tokens = await verifyOtp(email as string, code);
      setSession(tokens);
      navigate('/onboarding');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        setError('Incorrect or expired code. Please try again or request a new one.');
      } else {
        setError('Could not verify that code. Please try again.');
      }
      setCode('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      await resendOtp(email as string);
      setInfo('A new code has been sent to your email.');
      startCooldown();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        setError('Please wait a bit before requesting another code.');
        startCooldown();
      } else {
        setError('Could not resend the code. Please try again.');
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-display">Check your email</h1>
        <p className="mt-2 text-body text-text-muted">
          Enter the 6-digit code we sent to <span className="font-semibold text-text">{email}</span>. It expires in 5 minutes.
        </p>
      </div>
      <Card className="flex flex-col gap-4 p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldLabel>
            Verification code
            <Input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              required
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </FieldLabel>
          {error && <p className="text-body text-warn">{error}</p>}
          {info && <p className="text-body text-accent-strong">{info}</p>}
          <PrimaryButton type="submit" disabled={submitting || code.length !== 6}>
            {submitting ? 'Verifying…' : 'Verify'}
          </PrimaryButton>
        </form>
        <SecondaryButton type="button" onClick={handleResend} disabled={resending || cooldown > 0}>
          {cooldown > 0 ? `Resend code (${cooldown}s)` : resending ? 'Resending…' : 'Resend code'}
        </SecondaryButton>
      </Card>
    </div>
  );
}
