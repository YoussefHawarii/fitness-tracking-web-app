import { useEffect, useRef, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { googleLogin } from '../services/authService';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme: string;
              size: string;
              type: string;
              shape: string;
              text: string;
              logo_alignment: string;
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.87 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.98v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.71V4.96H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.04l2.98-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.96l2.98 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

// Loads Google Identity Services and renders its button. On success, the
// resulting ID token is sent to the backend's /auth/google endpoint for
// verification and account linking — the frontend never verifies it itself.
//
// The real widget is Google-hosted (a cross-origin iframe), so it can't take
// our CSS directly. Instead it's rendered transparently on top of a
// look-alike button styled to match the rest of the app; clicks land on the
// real widget underneath while what's visible is fully on-brand.
export function GoogleSignInButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { login: setSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId || !containerRef.current) return;

    const scriptId = 'google-identity-services';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      // hl=en pins the widget's UI language to English regardless of the
      // browser/OS locale, which otherwise drives Google's default text.
      script.src = 'https://accounts.google.com/gsi/client?hl=en';
      script.async = true;
      script.onload = renderButton;
      document.body.appendChild(script);
    } else {
      renderButton();
    }

    function renderButton() {
      if (!window.google || !containerRef.current || !wrapperRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId!,
        callback: async (response) => {
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const result = await googleLogin(response.credential, timezone);
          setSession(result);
          navigate(result.hasBaseline ? '/dashboard' : '/onboarding');
        },
      });
      containerRef.current.innerHTML = '';
      const width = Math.round(wrapperRef.current.getBoundingClientRect().width);
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        shape: 'rectangular',
        text: 'signin_with',
        logo_alignment: 'left',
        width,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function trackPointer(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${((event.clientX - rect.left) / rect.width) * 100}%`);
    event.currentTarget.style.setProperty('--my', `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }

  return (
    <div
      ref={wrapperRef}
      onMouseMove={trackPointer}
      className="spot-btn group relative w-full overflow-hidden rounded-xl"
    >
      <div
        aria-hidden
        className="pointer-events-none flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case tracking-[0.02em] text-text transition group-hover:border-accent group-hover:text-accent"
      >
        <GoogleGlyph />
        Continue with Google
      </div>
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl opacity-0"
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
