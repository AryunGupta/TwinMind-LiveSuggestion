// ─────────────────────────────────────────────────────────────
// APP.JS — Main controller
// Owns state, wires events, orchestrates API + audio + render.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_SETTINGS }                                      from './config.js';
import { transcribeAudio, fetchSuggestions, streamChat }        from './api.js';
import { AudioRecorder }                                         from './audio.js';
import {
  renderApiScreen, renderTopBar,
  renderTranscriptCol, renderSuggestionsCol,
  renderChatCol, renderSettings,
} from './render.js';

// ── State ─────────────────────────────────────────────────────

const state = {
  apiKey:                  '',
  apiKeyInput:             '',
  settings:                { ...DEFAULT_SETTINGS },
  showSettings:            false,

  isRecording:             false,
  isTranscribing:          false,
  isGeneratingSuggestions: false,
  isStreaming:             false,
  countdown:               null,

  transcriptChunks:        [],   // { id, text, timestamp }
  suggestionBatches:       [],   // { id, timestamp, suggestions[] }
  chatMessages:            [],   // { id, role, content, timestamp }
  chatInput:               '',
  streamingMsgId:          null,
  error:                   null,
};

// ── Non-reactive refs ─────────────────────────────────────────

let recorder      = null;
let cycleTimer    = null;
let countdownTimer = null;

// ── State helpers ─────────────────────────────────────────────

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function getFullTranscript() {
  return state.transcriptChunks.map(c => c.text).join(' ');
}

function scrollTo(id) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }));
}

// ── Audio / Transcription cycle ───────────────────────────────

async function onChunkReady(blob) {
  setState({ isTranscribing: true, error: null });
  try {
    const text = (await transcribeAudio(blob, state.apiKey, state.settings.whisperModel)).trim();
    if (!text) { setState({ isTranscribing: false }); return; }

    const chunk = { id: Date.now(), text, timestamp: new Date() };
    state.transcriptChunks.push(chunk);
    setState({ transcriptChunks: [...state.transcriptChunks], isTranscribing: false, isGeneratingSuggestions: true });
    scrollTo('transcript-end');

    await runSuggestions(text);
  } catch (err) {
    setState({ isTranscribing: false, error: err.message });
  }
}

async function runSuggestions(recentSegment) {
  const fullContext = getFullTranscript().slice(-state.settings.suggestionContextChars);

  // Collect recent suggestion titles so the model can avoid repeating them
  const previousTitles = state.suggestionBatches
    .slice(0, 3)
    .flatMap(b => b.suggestions.map(s => s.title))
    .filter(Boolean);

  try {
    const suggestions = await fetchSuggestions({
      apiKey:        state.apiKey,
      model:         state.settings.model,
      systemPrompt:  state.settings.suggestionPrompt,
      fullContext,
      recentSegment,
      previousTitles,
    });
    if (suggestions.length) {
      state.suggestionBatches.unshift({ id: Date.now(), timestamp: new Date(), suggestions });
      setState({ suggestionBatches: [...state.suggestionBatches] });
    }
  } catch (err) {
    setState({ error: err.message });
  } finally {
    setState({ isGeneratingSuggestions: false });
  }
}

function startCountdown() {
  let c = state.settings.chunkIntervalSeconds;
  countdownTimer = setInterval(() => {
    c--;
    setState({ countdown: c });
    if (c <= 0) c = state.settings.chunkIntervalSeconds;
  }, 1000);
}

// ── Recording controls ────────────────────────────────────────

async function startRecording() {
  if (!state.apiKey) { alert('Add your Groq API key first.'); return; }
  try {
    recorder = new AudioRecorder(onChunkReady);
    await recorder.start();
    setState({ isRecording: true, countdown: state.settings.chunkIntervalSeconds });
    startCountdown();
    cycleTimer = setInterval(() => recorder.cycle(), state.settings.chunkIntervalSeconds * 1000);
  } catch (err) {
    alert('Microphone error: ' + err.message);
  }
}

async function stopRecording() {
  clearInterval(cycleTimer);
  clearInterval(countdownTimer);
  setState({ isRecording: false, countdown: null });
  await recorder?.stop();
  recorder?.release();
  recorder = null;
}

async function manualRefresh() {
  if (state.isRecording) {
    clearInterval(cycleTimer);
    clearInterval(countdownTimer);
    await recorder.cycle();
    startCountdown();
    cycleTimer = setInterval(() => recorder.cycle(), state.settings.chunkIntervalSeconds * 1000);
  } else if (state.transcriptChunks.length > 0) {
    setState({ isGeneratingSuggestions: true, error: null });
    const recent = state.transcriptChunks.slice(-2).map(c => c.text).join(' ');
    await runSuggestions(recent);
  }
}

// ── Chat ──────────────────────────────────────────────────────

// displayText — shown in the chat bubble (clean)
// modelPrompt — sent to the LLM (may include hidden grounding context)
async function sendMessage(displayText, modelPrompt = null) {
  const textToShow = displayText.trim();
  const textToSend = (modelPrompt || displayText).trim();
  if (!textToShow || !state.apiKey || state.isStreaming) return;

  const userId      = Date.now();
  const assistantId = Date.now() + 1;

  state.chatMessages.push({ id: userId,      role: 'user',      content: textToShow, timestamp: new Date() });
  state.chatMessages.push({ id: assistantId, role: 'assistant', content: '',         timestamp: new Date() });
  setState({ chatMessages: [...state.chatMessages], chatInput: '', isStreaming: true, streamingMsgId: assistantId });
  scrollTo('chat-end');

  const transcriptContext = getFullTranscript().slice(-state.settings.chatContextChars);
  const history = state.chatMessages
    .slice(0, -1)
    .map(m => ({ role: m.role, content: m.content }));

  const messages = [
    { role: 'system', content: `${state.settings.chatSystemPrompt}\n\nMEETING TRANSCRIPT:\n${transcriptContext || '(none yet)'}` },
    ...history,
    { role: 'user', content: textToSend },
  ];

  try {
    let accumulated = '';
    for await (const token of streamChat({ apiKey: state.apiKey, model: state.settings.model, messages })) {
      accumulated += token;
      state.chatMessages = state.chatMessages.map(m =>
        m.id === assistantId ? { ...m, content: accumulated } : m
      );
      setState({ chatMessages: [...state.chatMessages] });
      scrollTo('chat-end');
    }
  } catch (err) {
    state.chatMessages = state.chatMessages.map(m =>
      m.id === assistantId ? { ...m, content: `⚠ Error: ${err.message}` } : m
    );
    setState({ chatMessages: [...state.chatMessages] });
  }

  setState({ isStreaming: false, streamingMsgId: null });
}

function handleSuggestionClick(suggestion) {
  // Clean question shown in bubble; richer context sent silently to model
  const modelPrompt = `${suggestion.expandPrompt}\n\n[Suggestion context: "${suggestion.preview}"]`;
  sendMessage(suggestion.expandPrompt, modelPrompt);
}

// ── Export ────────────────────────────────────────────────────

function exportSession() {
  const payload = {
    exportedAt:        new Date().toISOString(),
    transcript:        state.transcriptChunks.map(c => ({ timestamp: c.timestamp.toISOString(), text: c.text })),
    suggestionBatches: state.suggestionBatches.map(b => ({ timestamp: b.timestamp.toISOString(), suggestions: b.suggestions })),
    chat:              state.chatMessages.map(m => ({ timestamp: m.timestamp.toISOString(), role: m.role, content: m.content })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `twinmind-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Settings ──────────────────────────────────────────────────

function saveSettings() {
  const $ = id => document.getElementById(id);
  setState({
    showSettings: false,
    settings: {
      model:                  $('s-model').value.trim()   || DEFAULT_SETTINGS.model,
      whisperModel:           $('s-whisper').value.trim() || DEFAULT_SETTINGS.whisperModel,
      chunkIntervalSeconds:   parseInt($('s-interval').value)  || 30,
      suggestionContextChars: parseInt($('s-sug-ctx').value)   || 4000,
      chatContextChars:       parseInt($('s-chat-ctx').value)  || 8000,
      suggestionPrompt:       $('s-sug-prompt').value,
      chatSystemPrompt:       $('s-chat-prompt').value,
    },
  });
}

// ── Event binding ─────────────────────────────────────────────

function bindApiEvents() {
  const input = document.getElementById('api-input');
  input?.addEventListener('input',   e => { state.apiKeyInput = e.target.value; });
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') submitApiKey(); });
  document.getElementById('api-submit')?.addEventListener('click', submitApiKey);
}

function submitApiKey() {
  const key = state.apiKeyInput.trim();
  if (key) setState({ apiKey: key });
}

function bindMainEvents() {
  const $ = id => document.getElementById(id);

  $('start-btn')?.addEventListener('click',    startRecording);
  $('stop-btn')?.addEventListener('click',     stopRecording);
  $('refresh-btn')?.addEventListener('click',  manualRefresh);
  $('export-btn')?.addEventListener('click',   exportSession);
  $('settings-btn')?.addEventListener('click', () => setState({ showSettings: true }));

  $('close-settings')?.addEventListener('click',  () => setState({ showSettings: false }));
  $('save-settings')?.addEventListener('click',   saveSettings);
  $('reset-settings')?.addEventListener('click',  () => setState({ settings: { ...DEFAULT_SETTINGS }, showSettings: false }));
  $('settings-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'settings-overlay') setState({ showSettings: false });
  });

  const chatInput = $('chat-input');
  if (chatInput) {
    chatInput.addEventListener('input',   e => { state.chatInput = e.target.value; });
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(state.chatInput); }
    });
  }
  $('send-btn')?.addEventListener('click', () => sendMessage(state.chatInput));

  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const sug = state.suggestionBatches[+card.dataset.bi]?.suggestions[+card.dataset.si];
      if (sug) handleSuggestionClick(sug);
    });
  });
}

// ── Render ────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app');

  if (!state.apiKey) {
    app.innerHTML = renderApiScreen(state.apiKeyInput);
    bindApiEvents();
    return;
  }

  app.innerHTML = `
    ${renderTopBar(state)}
    <div class="layout">
      ${renderTranscriptCol(state.transcriptChunks)}
      ${renderSuggestionsCol(state.suggestionBatches, state.isGeneratingSuggestions)}
      ${renderChatCol(state.chatMessages, state.chatInput, state.isStreaming, state.streamingMsgId)}
      ${state.showSettings ? renderSettings(state.settings) : ''}
    </div>
  `;
  bindMainEvents();
}

// ── Boot ──────────────────────────────────────────────────────
render();
