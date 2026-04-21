// ─────────────────────────────────────────────────────────────
// GROQ API
// All network calls go here. Nothing else in the app talks to Groq.
// ─────────────────────────────────────────────────────────────

const GROQ_BASE = 'https://api.groq.com/openai/v1';

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

// ── Whisper transcription ─────────────────────────────────────

export async function transcribeAudio(blob, apiKey, model) {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const fd  = new FormData();
  fd.append('file',            new File([blob], `audio.${ext}`, { type: blob.type }));
  fd.append('model',           model);
  fd.append('response_format', 'text');

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method:  'POST',
    headers: authHeaders(apiKey),
    body:    fd,
  });
  if (!res.ok) throw new Error(`Whisper: ${await res.text()}`);
  return res.text();
}

// ── Suggestion generation (JSON mode) ────────────────────────

export async function fetchSuggestions({ apiKey, model, systemPrompt, fullContext, recentSegment, previousTitles = [] }) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method:  'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role:    'user',
          content: [
            `FULL TRANSCRIPT (context):\n${fullContext}`,
            `MOST RECENT SEGMENT (prioritize this):\n${recentSegment}`,
            previousTitles.length
              ? `ALREADY SHOWN (do NOT repeat these topics):\n${previousTitles.map(t => `- ${t}`).join('\n')}`
              : '',
            'Generate 3 fresh suggestions now.',
          ].filter(Boolean).join('\n\n'),
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens:      1000,
      temperature:     0.7,
    }),
  });
  if (!res.ok) throw new Error(`Suggestions: ${await res.text()}`);
  const data   = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
}

// ── Streaming chat completion ─────────────────────────────────

export async function* streamChat({ apiKey, model, messages }) {
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method:  'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream:      true,
      max_tokens:  2000,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Chat: ${await res.text()}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6);
      if (raw === '[DONE]') return;
      try {
        const token = JSON.parse(raw).choices[0]?.delta?.content;
        if (token) yield token;
      } catch { /* incomplete SSE chunk */ }
    }
  }
}
