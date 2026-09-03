import { useEffect, useRef } from 'react';
import { linkGoogleAccount } from '../services/accountService';

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

// Same Google Identity Services flow as GoogleSignInButton, but posts the
// resulting ID token to the account-linking endpoint instead of signing in
// (specs/008-sidebar-profile-account/research.md §5).
export function GoogleLinkButton({
  onLinked,
  onError,
}: {
  onLinked: () => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId || !containerRef.current) return;

    const scriptId = 'google-identity-services';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
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
          try {
            await linkGoogleAccount(response.credential);
            onLinked();
          } catch {
            onError('Could not link this Google account.');
          }
        },
      });
      containerRef.current.innerHTML = '';
      const width = Math.round(wrapperRef.current.getBoundingClientRect().width);
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'left',
        width,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapperRef} className="relative w-40 overflow-hidden rounded-xl">
      <div
        aria-hidden
        className="pointer-events-none flex w-full items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-2 text-label normal-case tracking-[0.02em] text-text"
      >
        Link Google
      </div>
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl opacity-0"
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
