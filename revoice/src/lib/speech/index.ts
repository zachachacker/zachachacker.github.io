import type { Settings } from "../types";
import type { SpeechProvider } from "./types";
import { WebSpeechProvider } from "./web-speech";
import { OpenAITranscriptionProvider } from "./openai-transcription";
import { SimulatedSpeechProvider, simulatedSpeechEnabled } from "./simulated";

export * from "./types";
export { EndOfSpeechDetector, PauseProfile } from "./end-of-speech";
export { simulatedSpeechEnabled };

/** `?speech=simulated` in the URL selects the test provider when it is enabled. */
export function resolveProviderId(settings: Settings): Settings["speechProvider"] {
  if (typeof window !== "undefined" && simulatedSpeechEnabled()) {
    const q = new URLSearchParams(window.location.search).get("speech");
    if (q === "simulated") return "simulated";
  }
  if (settings.speechProvider === "simulated" && !simulatedSpeechEnabled()) return "webspeech";
  return settings.speechProvider;
}

export function createProvider(id: Settings["speechProvider"]): SpeechProvider {
  switch (id) {
    case "openai":
      return new OpenAITranscriptionProvider();
    case "simulated":
      return new SimulatedSpeechProvider();
    default:
      return new WebSpeechProvider();
  }
}

export function webSpeechSupported(): boolean {
  return new WebSpeechProvider().isSupported();
}

/** Label, privacy note and support for a provider, without creating one. */
export function providerMeta(id: Settings["speechProvider"]): { label: string; privacyNote: string; supported: boolean } {
  const p = createProvider(id);
  const meta = { label: p.label, privacyNote: p.privacyNote, supported: p.isSupported() };
  p.dispose();
  return meta;
}
