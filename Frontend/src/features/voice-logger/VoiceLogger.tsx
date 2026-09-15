import { useRef, useState } from 'react';
import {
  searchFoodTranscript,
  type FoodMatch,
  type RecognizedFoodSearchResult,
} from '../../services/foodService';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/Card';
import { FieldLabel, Textarea } from '../../components/ui/Input';
import { useAccountContext } from '../../context/AccountContext';

// Maps the app's language-preference codes (Account page) to BCP-47 tags
// the Web Speech API expects. Falls back to English for any unmapped code.
// `ar-EG` (Egyptian Arabic) per docs/business-logic.md §5 and
// docs/requirements-spec.md §6 — previously specified but never wired in;
// see docs/food-log-input-modes-diagnosis.md §2.2.
const SPEECH_RECOGNITION_LOCALES: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  ar: 'ar-EG',
};

interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

interface Props {
  onMatchesSelected: (matches: FoodMatch[]) => void;
}

interface TermSearch {
  term: string;
  result: RecognizedFoodSearchResult;
}

const RECOGNITION_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    'Microphone access was blocked — allow it in your browser settings and try again.',
  'service-not-allowed':
    'Microphone access was blocked — allow it in your browser settings and try again.',
  'language-not-supported':
    "Your browser doesn't support this language for voice input.",
  'audio-capture': 'No microphone was found. Check your device and try again.',
  network:
    'Voice recognition needs a network connection — check your connection and try again.',
  'no-speech': "Didn't catch that — try recording again.",
};

// Web Speech API (browser-native, client-side only). Per docs/business-logic.md
// §5, the transcript is always shown for edit/confirmation before it is used
// to search — and candidate matches are presented rather than auto-selected.
export function VoiceLogger({ onMatchesSelected }: Props) {
  const { account, error: accountError } = useAccountContext();
  const [explicitLanguageChoice, setExplicitLanguageChoice] = useState<
    'en' | 'ar' | null
  >(null);
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [termSearches, setTermSearches] = useState<TermSearch[] | null>(null);
  const [selections, setSelections] = useState<Record<number, FoodMatch>>({});
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const accountLanguageChoice =
    account?.languagePreference === 'ar' ? 'ar' : 'en';
  const recognitionLanguageChoice =
    explicitLanguageChoice ?? accountLanguageChoice;

  function startRecording() {
    const SpeechRecognitionCtor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang =
      SPEECH_RECOGNITION_LOCALES[recognitionLanguageChoice] ?? 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setTranscript((prev) => (prev ? `${prev} ${text}` : text));
    };
    recognition.onerror = (event) => {
      const message =
        RECOGNITION_ERROR_MESSAGES[event.error ?? ''] ??
        'Could not transcribe. Try again or type manually.';
      setError(message);
    };
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
    setTermSearches(null);
    setSelections({});
    try {
      const { groups } = await searchFoodTranscript(transcript);
      setTermSearches(groups);

      const autoSelected: Record<number, FoodMatch> = {};
      groups.forEach((group, index) => {
        if (group.result.type === 'single') {
          autoSelected[index] = group.result.match;
        }
      });
      setSelections(autoSelected);

      if (groups.length === 0) {
        setError('No food items recognized — try manual entry instead.');
      }
    } catch {
      setError('Search failed. Try again or use manual entry.');
    }
  }

  function selectForTerm(index: number, match: FoodMatch) {
    setSelections((prev) => ({ ...prev, [index]: match }));
  }

  function handleLogSelected() {
    const matches = Object.values(selections);
    if (matches.length === 0) return;
    onMatchesSelected(matches);
    setTranscript('');
    setTermSearches(null);
    setSelections({});
  }

  const selectedCount = Object.keys(selections).length;
  const showTermLabels = (termSearches?.length ?? 0) > 1;
  const preferencesLoading = account === null && !accountError;

  return (
    <div className="flex flex-col gap-3">
      {!preferencesLoading && (
        <div className="flex flex-col items-start gap-2">
          <span className="text-label text-text-muted normal-case tracking-normal">
            Recording language
          </span>
          <SegmentedControl
            value={recognitionLanguageChoice}
            onChange={setExplicitLanguageChoice}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </div>
      )}

      <PrimaryButton
        type="button"
        disabled={preferencesLoading}
        onClick={recording ? stopRecording : startRecording}
        className="self-start"
      >
        {preferencesLoading
          ? 'Loading your preferences…'
          : recording
            ? 'Stop recording'
            : 'Record what you ate'}
      </PrimaryButton>

      <FieldLabel>
        Transcript (edit before confirming)
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={2}
          dir="auto"
        />
      </FieldLabel>

      <SecondaryButton
        type="button"
        disabled={!transcript.trim()}
        onClick={handleConfirm}
        className="self-start"
      >
        Confirm and search
      </SecondaryButton>

      {error && <p className="text-body text-warn">{error}</p>}

      {termSearches && termSearches.length > 0 && (
        <div className="flex flex-col gap-4">
          {termSearches.map((search, index) => (
            <div
              key={`${search.term}-${index}`}
              className="flex flex-col gap-2"
            >
              {showTermLabels && (
                <p
                  className="text-label text-text-muted normal-case tracking-normal"
                  dir="auto"
                >
                  {search.term}
                </p>
              )}
              {search.result.type === 'single' && (
                <p className="rounded-2xl border border-accent bg-accent-soft px-4 py-2.5 text-body">
                  ✓ {search.result.match.name} —{' '}
                  {search.result.match.caloriesPer100g} kcal/100g
                </p>
              )}
              {search.result.type === 'candidates' && (
                <ul className="flex flex-col gap-2">
                  {search.result.matches.map((match) => (
                    <li key={`${match.sourceType}-${match.sourceRef}`}>
                      <button
                        type="button"
                        onClick={() => selectForTerm(index, match)}
                        className={`w-full rounded-2xl border px-4 py-2.5 text-left text-body hover:bg-accent-soft ${
                          selections[index]?.sourceRef === match.sourceRef
                            ? 'border-accent bg-accent-soft'
                            : 'border-border bg-surface'
                        }`}
                      >
                        {match.name} — {match.caloriesPer100g} kcal/100g
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <PrimaryButton
            type="button"
            disabled={selectedCount === 0}
            onClick={handleLogSelected}
            className="self-start"
          >
            Log {selectedCount > 1 ? `${selectedCount} items` : 'this item'}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
