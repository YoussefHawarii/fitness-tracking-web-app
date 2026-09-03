import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login } from '../services/authService';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { Card } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login: setSession } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email, password });
      setSession(result);
      navigate(result.hasBaseline ? '/dashboard' : '/onboarding');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('Please verify your email — check your inbox for a code.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-display">Welcome back</h1>
      </div>
      <Card className="flex flex-col gap-4 p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldLabel>
            Email
            <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldLabel>
          <FieldLabel>
            Password
            <Input type="password" required placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FieldLabel>
          {error && <p className="text-body text-warn">{error}</p>}
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </PrimaryButton>
        </form>
        <div className="flex items-center gap-3 text-label text-text-muted">
          <span className="h-px flex-1 bg-border" />
          OR
          <span className="h-px flex-1 bg-border" />
        </div>
        <GoogleSignInButton />
      </Card>
      <p className="text-center text-body text-text-muted">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="font-semibold text-accent-strong">
          Sign up
        </Link>
      </p>
    </div>
  );
}
