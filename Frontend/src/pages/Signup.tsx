import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signup } from '../services/authService';
import { Card } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';

export function Signup() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await signup({ username, email, password, timezone });
      navigate('/verify-otp', { state: { email: result.email } });
    } catch {
      setError('Could not create an account with that username/email. One of them may already be in use.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-display">Create your account</h1>
      </div>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FieldLabel>
            Username
            <Input
              type="text"
              required
              minLength={3}
              maxLength={30}
              placeholder="yourname"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel>
            Email
            <Input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldLabel>
          <FieldLabel>
            Password
            <Input
              type="password"
              required
              minLength={8}
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FieldLabel>
          {error && <p className="text-body text-warn">{error}</p>}
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? 'Sending verification email…' : 'Send verification email'}
          </PrimaryButton>
        </form>
      </Card>
      <p className="text-center text-body text-text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-accent-strong">
          Log in
        </Link>
      </p>
    </div>
  );
}
