// Falls back to the in-repo placeholder page when the corresponding env var
// isn't configured (research.md §8).
export const HELP_CENTER_URL = import.meta.env.VITE_HELP_CENTER_URL || '/legal/help';
export const TERMS_URL = import.meta.env.VITE_TERMS_URL || '/legal/terms';
export const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL || '/legal/privacy';
