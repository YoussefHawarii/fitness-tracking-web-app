const INITIALS_BACKGROUNDS = [
  'bg-accent text-bg',
  'bg-[oklch(85%_0.13_220)] text-bg',
  'bg-[oklch(78%_0.17_350)] text-bg',
  'bg-[oklch(78%_0.14_300)] text-bg',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsFor(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  avatarUrl: string | null;
  displayName: string;
  size?: number;
  className?: string;
}

export function Avatar({ avatarUrl, displayName, size = 36, className = '' }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const background = INITIALS_BACKGROUNDS[hashString(displayName) % INITIALS_BACKGROUNDS.length];

  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full text-label ${background} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsFor(displayName)}
    </span>
  );
}
