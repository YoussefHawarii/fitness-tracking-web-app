import { useRef, useState } from 'react';
import { searchFood, type FoodMatch, type FoodSearchResult } from '../../services/foodService';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { FieldLabel, Textarea } from '../../components/ui/Input';
import { useAccountContext } from '../../context/AccountContext';
import { splitIntoFoodTerms } from './splitIntoFoodTerms';

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

// A rejected search (network blip) is distinct from a genuine empty result —
// conflating them as 'empty' would tell the user "no match found" for a term
// that was never actually searched.
type TermSearchResult = FoodSearchResult | { type: 'error' };

interface TermSearch {
  term: string;
  result: TermSearchResult;
}

const RECOGNITION_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked — allow it in your browser settings and try again.',
  'service-not-allowed': 'Microphone access was blocked — allow it in your browser settings and try again.',
  'language-not-supported': "Your browser doesn't support this language for voice input.",
  'audio-capture': 'No microphone was found. Check your device and try again.',
  network: 'Voice recognition needs a network connection — check your connection and try again.',
  'no-speech': "Didn't catch that — try recording again.",
};

// Web Speech API (browser-native, client-side only). Per docs/business-logic.md
// §5, the transcript is always shown for edit/confirmation before it is used
// to search — and candidate matches are presented rather than auto-selected.
export function VoiceLogger({ onMatchesSelected }: Props) {
  const { account, error: accountError } = useAccountContext();
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [termSearches, setTermSearches] = useState<TermSearch[] | null>(null);
  const [selections, setSelections] = useState<Record<number, FoodMatch>>({});
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function startRecording() {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('Voice input is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang =
      SPEECH_RECOGNITION_LOCALES[account?.languagePreference ?? 'en'] ??
      'en-US';
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
    const terms = splitIntoFoodTerms(transcript);
    if (terms.length === 0) {
      setError('No matches found — try manual entry instead.');
      return;
    }
    // allSettled rather than all — a network blip on one term (out of
    // possibly several, when the transcript split into multiple foods)
    // shouldn't discard results already found for the others.
    const outcomes = await Promise.allSettled(terms.map((term) => searchFood(term)));
    const searches: TermSearch[] = terms.map((term, i) => {
      const outcome = outcomes[i];
      return {
        term,
        result: outcome.status === 'fulfilled' ? outcome.value : { type: 'error' },
      };
    });
    setTermSearches(searches);

    const autoSelected: Record<number, FoodMatch> = {};
    searches.forEach((s, i) => {
      if (s.result.type === 'single') autoSelected[i] = s.result.match;
    });
    setSelections(autoSelected);

    const hasActionableResult = searches.some(
      (s) => s.result.type === 'single' || s.result.type === 'candidates',
    );
    const anyFailed = searches.some((s) => s.result.type === 'error');
    if (!hasActionableResult) {
      setError(
        anyFailed
          ? 'Search failed. Try again or use manual entry.'
          : 'No matches found — try manual entry instead.',
      );
    } else if (anyFailed) {
      setError('Some terms could not be searched — try again for those, or use manual entry.');
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

      <SecondaryButton type="button" disabled={!transcript.trim()} onClick={handleConfirm} className="self-start">
        Confirm and search
      </SecondaryButton>

      {error && <p className="text-body text-warn">{error}</p>}

      {termSearches && termSearches.length > 0 && (
        <div className="flex flex-col gap-4">
          {termSearches.map((search, index) => (
            <div key={`${search.term}-${index}`} className="flex flex-col gap-2">
              {showTermLabels && (
                <p className="text-label text-text-muted normal-case tracking-normal" dir="auto">
                  {search.term}
                </p>
              )}
              {search.result.type === 'empty' && (
                <p className="text-body text-text-muted">No match found for "{search.term}".</p>
              )}
              {search.result.type === 'error' && (
                <p className="text-body text-warn">Couldn't search for "{search.term}" — try again.</p>
              )}
              {search.result.type === 'single' && (
                <p className="rounded-2xl border border-accent bg-accent-soft px-4 py-2.5 text-body">
                  ✓ {search.result.match.name} — {search.result.match.caloriesPer100g} kcal/100g
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
