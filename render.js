// ─────────────────────────────────────────────────────────────
// RENDER HELPERS
// Pure functions: state → HTML string.
// No side effects. No DOM reads. No API calls.
// ─────────────────────────────────────────────────────────────

import { TYPE_META, DEFAULT_SETTINGS } from './config.js';

// ── Utilities ─────────────────────────────────────────────────

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Screens ───────────────────────────────────────────────────

export function renderApiScreen(apiKeyInput) {
  return `
    <div class="api-screen">
      <div class="api-card">
        <div class="api-logo">Twin<span>Mind</span></div>
        <div class="api-tagline">Live Meeting Intelligence</div>
        <div class="api-desc">
          Paste your Groq API key to start. Audio goes directly to Groq —
          nothing is stored when you reload.
        </div>
        <input
          id="api-input"
          class="api-input"
          type="password"
          placeholder="gsk_…"
          value="${escapeHtml(apiKeyInput)}"
          autocomplete="off"
        />
        <button class="api-btn" id="api-submit">Start Session →</button>
        <div class="api-hint">
          Get your free key at <a href="https://console.groq.com" target="_blank">console.groq.com</a>
        </div>
      </div>
    </div>
  `;
}

// ── Top Bar ───────────────────────────────────────────────────

export function renderTopBar({ isRecording, isTranscribing, isGeneratingSuggestions, countdown, error }) {
  const dotCls = (isRecording || isTranscribing) ? 'active' : '';
  const label  = isTranscribing ? 'Transcribing…'
               : isRecording    ? `Recording · ${countdown ?? '–'}s`
               : 'Ready';

  return `
    <div class="topbar">
      <div class="logo">Twin<span>Mind</span></div>
      <div class="topbar-status">
        <span class="status-dot ${dotCls}"></span>
        <span>${label}</span>
        ${isGeneratingSuggestions ? '<span class="spinner"></span>' : ''}
      </div>
      ${error ? `<span class="topbar-error" title="${escapeHtml(error)}">⚠ ${escapeHtml(error)}</span>` : ''}
      <div class="spacer"></div>
      ${isRecording
        ? `<button class="btn danger" id="stop-btn">⏹ Stop</button>`
        : `<button class="btn primary" id="start-btn">🎤 Record</button>`
      }
      <button class="btn" id="refresh-btn" ${isGeneratingSuggestions ? 'disabled' : ''}>↻ Refresh</button>
      <button class="btn" id="export-btn">↓ Export</button>
      <button class="btn icon" id="settings-btn" title="Settings">⚙</button>
    </div>
  `;
}

// ── Transcript Column ─────────────────────────────────────────

export function renderTranscriptCol(chunks) {
  const body = chunks.length === 0
    ? `<div class="empty-state">
         <div class="empty-icon">🎙</div>
         <div class="empty-label">Press Record and start talking.<br>Chunks appear every ~30 seconds.</div>
       </div>`
    : chunks.map((c, i) => `
        <div class="transcript-chunk">
          <div class="chunk-meta">${fmtTime(c.timestamp)}</div>
          <div class="chunk-text ${i === chunks.length - 1 ? 'latest' : ''}">${escapeHtml(c.text)}</div>
        </div>
      `).join('') + '<div id="transcript-end"></div>';

  return `
    <div class="col">
      <div class="col-header">
        <span class="col-title">Transcript</span>
        <span class="col-meta">${chunks.length} chunk${chunks.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="col-body">${body}</div>
    </div>
  `;
}

// ── Suggestions Column ────────────────────────────────────────

export function renderSuggestionsCol(batches, isGenerating) {
  const loading = isGenerating
    ? `<div class="generating-row"><span class="spinner"></span> Generating suggestions…</div>`
    : '';

  const empty = batches.length === 0 && !isGenerating
    ? `<div class="empty-state">
         <div class="empty-icon">💡</div>
         <div class="empty-label">Suggestions appear after the first<br>transcript chunk is processed.</div>
       </div>`
    : '';

  const batchesHtml = batches.map((batch, bi) => {
    const label    = bi === 0 ? 'Latest' : fmtTime(batch.timestamp);
    const labelCls = bi === 0 ? '' : 'old';

    const cards = batch.suggestions.map((s, si) => {
      const meta = TYPE_META[s.type] || TYPE_META.ANSWER;
      return `
        <div class="suggestion-card" data-bi="${bi}" data-si="${si}">
          <span class="suggestion-type ${meta.cls}">${meta.label}</span>
          <div class="suggestion-title">${escapeHtml(s.title || '')}</div>
          <div class="suggestion-preview">${escapeHtml(s.preview || '')}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="batch">
        <div class="batch-label ${labelCls}">${label}</div>
        ${cards}
      </div>
    `;
  }).join('');

  return `
    <div class="col">
      <div class="col-header">
        <span class="col-title">Live Suggestions</span>
        <span class="col-meta">${batches.length} batch${batches.length !== 1 ? 'es' : ''}</span>
      </div>
      <div class="col-body">
        ${loading}
        ${empty}
        ${batchesHtml}
      </div>
    </div>
  `;
}

// ── Chat Column ───────────────────────────────────────────────

export function renderChatCol(messages, chatInput, isStreaming, streamingMsgId) {
  const body = messages.length === 0
    ? `<div class="empty-state">
         <div class="empty-icon">💬</div>
         <div class="empty-label">Click a suggestion for a detailed answer,<br>or type a question directly.</div>
       </div>`
    : messages.map(m => {
        const isThisStreaming = m.id === streamingMsgId;
        const content = escapeHtml(m.content).replace(/\n/g, '<br>');
        return `
          <div class="chat-msg ${m.role} ${isThisStreaming ? 'streaming' : ''}">
            ${content}${isThisStreaming ? '<span class="cursor"></span>' : ''}
          </div>
        `;
      }).join('') + '<div id="chat-end"></div>';

  return `
    <div class="col" style="display:flex;flex-direction:column;">
      <div class="col-header">
        <span class="col-title">Chat</span>
        ${isStreaming ? '<span class="spinner"></span>' : ''}
      </div>
      <div class="chat-body">${body}</div>
      <div class="chat-footer">
        <input
          id="chat-input"
          class="chat-input"
          placeholder="Ask anything about the meeting…"
          value="${escapeHtml(chatInput)}"
        />
        <button class="send-btn" id="send-btn" ${isStreaming ? 'disabled' : ''}>→</button>
      </div>
    </div>
  `;
}

// ── Settings Modal ────────────────────────────────────────────

export function renderSettings(settings) {
  const s = settings;
  return `
    <div class="modal-overlay" id="settings-overlay">
      <div class="modal">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="modal-title">Settings</div>
          <button class="btn icon" id="close-settings">✕</button>
        </div>

        <div class="modal-row">
          <div class="modal-section">
            <div class="modal-label">LLM Model</div>
            <input class="modal-input" id="s-model" value="${escapeHtml(s.model)}" />
          </div>
          <div class="modal-section">
            <div class="modal-label">Whisper Model</div>
            <input class="modal-input" id="s-whisper" value="${escapeHtml(s.whisperModel)}" />
          </div>
        </div>

        <div class="modal-row">
          <div class="modal-section">
            <div class="modal-label">Chunk Interval (s)</div>
            <input class="modal-input" id="s-interval" type="number" min="10" max="120" value="${s.chunkIntervalSeconds}" />
          </div>
          <div class="modal-section">
            <div class="modal-label">Suggestion Context (chars)</div>
            <input class="modal-input" id="s-sug-ctx" type="number" value="${s.suggestionContextChars}" />
          </div>
          <div class="modal-section">
            <div class="modal-label">Chat Context (chars)</div>
            <input class="modal-input" id="s-chat-ctx" type="number" value="${s.chatContextChars}" />
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-label">Live Suggestion Prompt</div>
          <textarea class="modal-textarea" id="s-sug-prompt" style="min-height:130px;">${escapeHtml(s.suggestionPrompt)}</textarea>
        </div>

        <div class="modal-section">
          <div class="modal-label">Chat System Prompt</div>
          <textarea class="modal-textarea" id="s-chat-prompt">${escapeHtml(s.chatSystemPrompt)}</textarea>
        </div>

        <div class="modal-footer">
          <button class="btn" id="reset-settings">Reset Defaults</button>
          <button class="btn primary" id="save-settings">Save Settings</button>
        </div>
      </div>
    </div>
  `;
}
