import { useRef, useState } from 'react';
import { searchUsda, type UsdaFoodMatch } from '../../services/foodService';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { FieldLabel, Textarea } from '../../components/ui/Input';

interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

interface Props {
  onMatchSelected: (match: UsdaFoodMatch) => void;
}

// Web Speech API (browser-native, client-side only). Per docs/business-logic.md
// §5, the transcript is always shown for edit/confirmation before it is used
// to search — and candidate matches are presented rather than auto-selected.
export function VoiceLogger({ onMatchSelected }: Props) {
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [matches, setMatches] = useState<UsdaFoodMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function startRecording() {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ar-EG';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setTranscript((prev) => (prev ? `${prev} ${text}` : text));
    };
    recognition.onerror = () => setError('Could not transcribe. Try again or type manually.');
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    setRecording(false);
  }

  async function handleConfirm() {
    setError(null);
    setMatches(null);
    try {
      const results = await searchUsda(transcript);
      if (results.length === 0) {
        setError('No matches found — try manual entry instead.');
        return;
      }
      setMatches(results);
    } catch {
      setError('Search failed. Try again or use manual entry.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <PrimaryButton type="button" onClick={recording ? stopRecording : startRecording} className="self-start">
        {recording ? 'Stop recording' : 'Record what you ate'}
      </PrimaryButton>

      <FieldLabel>
        Transcript (edit before confirming)
        <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={2} />
      </FieldLabel>

      <SecondaryButton type="button" disabled={!transcript.trim()} onClick={handleConfirm} className="self-start">
        Confirm and search
      </SecondaryButton>

      {error && <p className="text-body text-warn">{error}</p>}

      {matches && (
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li key={match.fdcId}>
              <button
                type="button"
                onClick={() => onMatchSelected(match)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-left text-body hover:bg-accent-soft"
              >
                {match.name} — {match.caloriesPer100g} kcal/100g
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
