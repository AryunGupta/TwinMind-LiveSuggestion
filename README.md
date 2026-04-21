# TwinMind — Live Suggestions

**Live demo:** https://sprightly-marshmallow-c946e9.netlify.app

A real-time meeting intelligence web app built for the TwinMind prompt engineering assignment. It listens to live audio, transcribes it in 30-second chunks, and continuously surfaces 3 contextual suggestions based on what is being said. Clicking a suggestion opens a detailed streaming answer in a chat panel.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Vanilla JS, ES modules, no framework | Zero build step, instant Netlify deploy, fully auditable |
| Transcription | Groq Whisper Large V3 | ~3s for a 30s chunk — fast enough to feel live |
| LLM | Groq `llama-3.3-70b-versatile` | Reliable JSON mode, ~300 tok/s, large context window |
| Audio capture | Browser MediaRecorder API | Native, no dependencies, handles all major formats |
| Streaming | Groq SSE | First chat token arrives in under 500ms |

The app is entirely client-side. The Groq API key is held only in browser memory and goes directly to `api.groq.com` — no backend, no logging, no persistence.

---

## File Structure

```
index.html   — 15-line HTML shell, links CSS and boots app.js
styles.css   — all visual styles
config.js    — default prompts and settings constants
api.js       — all Groq calls: Whisper, suggestions (JSON mode), chat (streaming)
audio.js     — AudioRecorder class: mic access, MediaRecorder chunking, blob collection
render.js    — pure HTML-string render functions, one per UI section
app.js       — main controller: state, event binding, orchestration
```

---

## How It Works

### Audio pipeline

The browser's `MediaRecorder` API captures mic audio in 30-second blobs. Each blob is sent as `multipart/form-data` to Groq's Whisper endpoint, which returns plain text. The transcript appends to the left column and immediately triggers suggestion generation. The 30-second interval is configurable down to 10 seconds via the settings panel.

### Suggestion engine

Each cycle sends two things to the LLM separately:

1. **Full transcript context** — last 4,000 characters, so the model understands the overall topic
2. **Most recent segment** — the just-transcribed chunk, labeled explicitly so the model knows what just happened vs. background

I pass these separately rather than concatenating because recency weighting is everything in a live meeting. If you concatenate 4,000 characters, the model treats everything equally. Labeling the recent segment forces it to prioritize the last 30 seconds.

The model responds in `response_format: json_object` — guaranteed parseable JSON, no markdown fences to strip. Each suggestion has a type, title, preview, and an `expandPrompt` for the chat.

To prevent repetition across cycles, I also pass the titles of the last 3 batches to the model with an explicit instruction to avoid those topics.

### Suggestion types

I use 5 types and let the prompt decide which fits the moment — not a rotation:

- **ANSWER** — triggered when a question was just asked; goes first
- **QUESTION** — a smart follow-up when the conversation is flowing naturally
- **TALKING_POINT** — a relevant fact, stat, or angle worth adding
- **FACT_CHECK** — when a claim is made; the preview states whether it is correct or not
- **CLARIFY** — when jargon or a complex concept surfaces without explanation

The key constraint on every type: **the preview must deliver the actual value, not a teaser.** A preview that says "click to learn more" is worthless during a live meeting. The prompt explicitly prohibits this.

### Chat

Clicking a suggestion sends its `expandPrompt` to the model, with the preview passed silently as grounding context. The chat bubble shows only the clean question — not the internal prompt construction. Users can also type directly. Full conversation history is included on every turn. Chat context window defaults to 8,000 characters of transcript, configurable in settings.

---

## Prompt Strategy

### The core tension I was solving

Real-time suggestions have two failure modes: too generic (useless) or too slow (irrelevant by the time they arrive). Every prompt decision was made to address one of these.

**Against generic:** I never ask for "helpful suggestions." I ask the model to pick the type that fits the current moment and ground every preview in what was literally just said. The prompt includes an explicit rule: "be hyper-specific to what was actually said — no generic meeting advice."

**Against irrelevant:** The recent segment is passed separately with explicit priority. The 30-second chunk interval keeps the feedback loop tight. The suggestion prompt is optimised for speed — 1,000 max tokens, temperature 0.7.

### Why temperature 0.7

At 0.3, suggestions become repetitive and overly conservative — the model converges on the same safe phrasing every cycle. At 0.9, suggestions get creative but start hallucinating or ignoring the transcript. 0.7 gives variety while staying grounded in what was said.

### Context window sizing

4,000 characters for suggestions (~3 minutes of speech) and 8,000 for chat (~6 minutes). The asymmetry is intentional: suggestions need to be fast, chat can afford more context. At 4,000 chars, suggestion latency stays under 2 seconds on Groq even in longer meetings. Both are editable in the settings panel.

---

## Settings

Everything is editable in-app via the ⚙ gear icon. Defaults are the values I found to work best:

| Setting | Default |
|---|---|
| LLM Model | `llama-3.3-70b-versatile` |
| Whisper Model | `whisper-large-v3` |
| Chunk interval | 30s |
| Suggestion context | 4,000 chars |
| Chat context | 8,000 chars |
| Suggestion prompt | See `config.js` |
| Chat prompt | See `config.js` |

---

## Export format

```json
{
  "exportedAt": "...",
  "transcript": [{ "timestamp": "...", "text": "..." }],
  "suggestionBatches": [{
    "timestamp": "...",
    "suggestions": [{ "type": "...", "title": "...", "preview": "...", "expandPrompt": "..." }]
  }],
  "chat": [{ "timestamp": "...", "role": "user|assistant", "content": "..." }]
}
```

---

## What I would improve with more time

**Speaker diarization.** With speaker labels, suggestions could be attributed — "the other person just asked X" vs. "you just claimed Y" — which changes what type of suggestion is appropriate.

**Smarter cycle trigger.** If the new chunk is semantically similar to the previous one, skip regeneration and wait for the conversation to shift. Right now it regenerates on every chunk regardless.

**Streaming transcription.** Whisper processes audio after the chunk closes, creating a visible wait. A streaming STT approach would reduce perceived latency significantly.

**Grounded fact-checking.** FACT_CHECK currently relies on the LLM's training data. Connecting it to a web search tool would make it reliable for verifying claims made in real time.

**Token-based context windows.** Character counts are a proxy for token counts. Proper token counting would let me stay right up against the model's context limit without guessing.

---

## Known limitation

The app makes direct browser-to-Groq API calls. Some VPN configurations and corporate DNS filters block `api.groq.com`, causing API errors. Disabling VPN resolves this. In production, a server-side proxy would eliminate this dependency.
