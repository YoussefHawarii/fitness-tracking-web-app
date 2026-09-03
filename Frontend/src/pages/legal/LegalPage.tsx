import type { ReactNode } from 'react';
import { Card } from '../../components/ui/Card';

// In-repo fallback shown when the corresponding VITE_*_URL env var isn't
// configured (research.md §8) — placeholder content, not real legal copy.
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-display">{title}</h1>
      <Card className="p-6 text-body text-text-muted">{children}</Card>
    </div>
  );
}
