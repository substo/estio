export const REPLAY_SPEECH_MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"] as const;
export type ReplaySpeechModel = typeof REPLAY_SPEECH_MODELS[number];
export const REPLAY_SPEECH_VOICES = ["Kore", "Aoede", "Puck", "Charon"] as const;
