import { useRef, useState, type ReactNode } from 'react';
import {
  updateDisplayName,
  updatePreferences,
  getAvatarUploadSignature,
  uploadToCloudinary,
  confirmAvatarUpload,
  removeAvatar,
  changePassword,
  setPassword,
  unlinkGoogleAccount,
  sendFeedback,
  type AccountProfile,
  type Units,
} from '../services/accountService';
import { Card, SegmentedControl } from '../components/ui/Card';
import { Input, FieldLabel, Select, Textarea } from '../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { GoogleLinkButton } from '../components/GoogleLinkButton';
import { Avatar } from '../components/profile-menu/Avatar';
import { useTheme } from '../context/ThemeContext';
import { useAccountContext } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { HELP_CENTER_URL, TERMS_URL, PRIVACY_URL } from '../utils/legalLinks';

const MAX_AVATAR_BYTES = 8 * 1024 * 1024; // client-side pre-check only — Cloudinary handles real limits/optimization
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Only English is fully translated today (data-model.md's supported-language
// list); the others are offered so the "not yet supported" notice (FR-020)
// has something to demonstrate.
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
];
const FULLY_SUPPORTED_LANGUAGES = ['en'];

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-4 text-body">
      <span className="text-text">{label}</span>
      <span className="flex shrink-0 items-center gap-2">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-label text-text-muted">{title}</h2>
      <Card className="flex flex-col divide-y divide-border">{children}</Card>
    </div>
  );
}

function AccountSection({
  account,
  onChanged,
}: {
  account: AccountProfile;
  onChanged: () => void;
}) {
  const [nameInput, setNameInput] = useState(account.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [passwordMode, setPasswordMode] = useState<'change' | 'set' | null>(null);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [googleError, setGoogleError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  async function handleSaveName() {
    setNameError(null);
    setSavingName(true);
    try {
      await updateDisplayName(nameInput);
      onChanged();
    } catch {
      setNameError('Could not update your display name.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleAvatarFileSelected(file: File) {
    setAvatarError(null);
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError('Please choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('That image is too large — please choose a smaller one.');
      return;
    }
    setAvatarUploading(true);
    try {
      const signature = await getAvatarUploadSignature();
      const uploaded = await uploadToCloudinary(signature, file);
      await confirmAvatarUpload(uploaded.secure_url, uploaded.public_id);
      onChanged();
    } catch {
      setAvatarError('Could not upload that photo — please try again.');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      await removeAvatar();
      onChanged();
    } catch {
      setAvatarError('Could not remove your photo.');
    } finally {
      setAvatarUploading(false);
    }
  }

  function openPasswordForm() {
    setPasswordError(null);
    setCurrentPasswordInput('');
    setNewPasswordInput('');
    setPasswordMode(account.hasPassword ? 'change' : 'set');
  }

  async function handleSavePassword() {
    setPasswordError(null);
    if (newPasswordInput.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      if (passwordMode === 'change') {
        await changePassword(currentPasswordInput, newPasswordInput);
      } else {
        await setPassword(newPasswordInput);
      }
      setPasswordMode(null);
      onChanged();
    } catch {
      setPasswordError(
        passwordMode === 'change'
          ? 'Current password is incorrect.'
          : 'Could not set your password.',
      );
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleUnlinkGoogle() {
    setGoogleError(null);
    setUnlinking(true);
    try {
      await unlinkGoogleAccount();
      onChanged();
    } catch {
      setGoogleError(
        "Can't unlink — set a password first so you still have a way to sign in.",
      );
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <>
      <Row label="Photo">
        <Avatar avatarUrl={account.avatarUrl} displayName={account.displayName} size={40} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleAvatarFileSelected(file);
            e.target.value = '';
          }}
        />
        <SecondaryButton
          type="button"
          disabled={avatarUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {avatarUploading ? 'Uploading…' : 'Change'}
        </SecondaryButton>
        {account.avatarUrl && (
          <SecondaryButton type="button" disabled={avatarUploading} onClick={handleRemoveAvatar}>
            Remove
          </SecondaryButton>
        )}
      </Row>
      {avatarError && <p className="px-4 pb-2 text-body text-warn">{avatarError}</p>}

      <Row label="Display name">
        <Input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          className="w-48"
        />
        <PrimaryButton
          type="button"
          disabled={savingName || nameInput.trim() === account.displayName}
          onClick={handleSaveName}
        >
          {savingName ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </Row>
      {nameError && <p className="px-4 pb-2 text-body text-warn">{nameError}</p>}

      {passwordMode ? (
        <div className="flex flex-col gap-3 p-4">
          <p className="text-body text-text">
            {passwordMode === 'change' ? 'Change password' : 'Set a password'}
          </p>
          {passwordMode === 'change' && (
            <FieldLabel>
              Current password
              <Input
                type="password"
                value={currentPasswordInput}
                onChange={(e) => setCurrentPasswordInput(e.target.value)}
              />
            </FieldLabel>
          )}
          <FieldLabel>
            New password
            <Input
              type="password"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
            />
          </FieldLabel>
          {passwordError && <p className="text-body text-warn">{passwordError}</p>}
          <div className="flex gap-2">
            <PrimaryButton type="button" disabled={savingPassword} onClick={handleSavePassword}>
              {savingPassword ? 'Saving…' : 'Save password'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => setPasswordMode(null)}>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <Row label="Password">
          <SecondaryButton type="button" onClick={openPasswordForm}>
            {account.hasPassword ? 'Change password' : 'Set password'}
          </SecondaryButton>
        </Row>
      )}

      <Row label="Google account">
        {account.googleLinked ? (
          <>
            <span className="text-text-muted">Connected</span>
            <SecondaryButton type="button" disabled={unlinking} onClick={handleUnlinkGoogle}>
              {unlinking ? 'Unlinking…' : 'Unlink'}
            </SecondaryButton>
          </>
        ) : (
          <>
            <span className="text-text-muted">Not connected</span>
            <GoogleLinkButton onLinked={onChanged} onError={setGoogleError} />
          </>
        )}
      </Row>
      {googleError && <p className="px-4 pb-2 text-body text-warn">{googleError}</p>}
    </>
  );
}

function PreferencesSection({
  account,
  onChanged,
}: {
  account: AccountProfile;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleUnitsChange(unitsPreference: Units) {
    setSaving(true);
    try {
      await updatePreferences({ unitsPreference });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleLanguageChange(languagePreference: string) {
    setSaving(true);
    try {
      await updatePreferences({ languagePreference });
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  const languageSupported = FULLY_SUPPORTED_LANGUAGES.includes(account.languagePreference);

  return (
    <>
      <Row label="Units">
        <SegmentedControl
          value={account.unitsPreference}
          onChange={handleUnitsChange}
          className={saving ? 'opacity-60' : ''}
          options={[
            { value: 'KG', label: 'kg' },
            { value: 'LB', label: 'lb' },
          ]}
        />
      </Row>
      <Row label="Language">
        <Select
          value={account.languagePreference}
          disabled={saving}
          onChange={(e) => void handleLanguageChange(e.target.value)}
          className="w-36"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.label}
            </option>
          ))}
        </Select>
      </Row>
      {!languageSupported && (
        <p className="px-4 pb-3 text-body text-text-muted">
          This language isn't fully supported yet — the app will still show English text in places.
        </p>
      )}
    </>
  );
}

function SupportSection() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSend() {
    if (!subject.trim() || !message.trim()) {
      setStatus('Enter a subject and a message.');
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      await sendFeedback(subject, message);
      setSubject('');
      setMessage('');
      setStatus('Thanks — your feedback was sent.');
    } catch {
      setStatus('Could not send your feedback — please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-body text-text">Send feedback</p>
        <FieldLabel>
          Subject
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
        </FieldLabel>
        <FieldLabel>
          Message
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={4}
          />
        </FieldLabel>
        {status && <p className="text-body text-text-muted">{status}</p>}
        <PrimaryButton type="button" disabled={sending} onClick={handleSend} className="self-start">
          {sending ? 'Sending…' : 'Send feedback'}
        </PrimaryButton>
      </div>
      <Row label="Help Center">
        <a
          href={HELP_CENTER_URL}
          target={HELP_CENTER_URL.startsWith('http') ? '_blank' : undefined}
          rel={HELP_CENTER_URL.startsWith('http') ? 'noreferrer' : undefined}
          className="text-body text-accent hover:underline"
        >
          Visit Help Center
        </a>
      </Row>
    </>
  );
}

function AboutSection() {
  return (
    <>
      <Row label="Version">
        <span className="text-readout text-text-muted">{__APP_VERSION__}</span>
      </Row>
      <Row label="Terms of Service">
        <a
          href={TERMS_URL}
          target={TERMS_URL.startsWith('http') ? '_blank' : undefined}
          rel={TERMS_URL.startsWith('http') ? 'noreferrer' : undefined}
          className="text-body text-accent hover:underline"
        >
          View
        </a>
      </Row>
      <Row label="Privacy Policy">
        <a
          href={PRIVACY_URL}
          target={PRIVACY_URL.startsWith('http') ? '_blank' : undefined}
          rel={PRIVACY_URL.startsWith('http') ? 'noreferrer' : undefined}
          className="text-body text-accent hover:underline"
        >
          View
        </a>
      </Row>
    </>
  );
}

export function Account() {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const { account, error, refresh } = useAccountContext();

  if (error) {
    return <p className="p-6 text-body text-warn">{error}</p>;
  }

  if (!account) {
    return <p className="p-6 text-body text-text-muted">Loading…</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-display">Settings</h1>

      <Section title="Account">
        <AccountSection account={account} onChanged={refresh} />
      </Section>

      <Section title="Preferences">
        <PreferencesSection account={account} onChanged={refresh} />
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
        </Row>
      </Section>

      <Section title="Support">
        <SupportSection />
      </Section>

      <Section title="About">
        <AboutSection />
      </Section>

      <Card className="p-0">
        <button
          type="button"
          onClick={() => void logout()}
          className="flex w-full items-center justify-center rounded-card px-4 py-3 text-left text-body font-semibold text-warn transition hover:bg-warn-soft"
        >
          Log out
        </button>
      </Card>
    </div>
  );
}
