// ─────────────────────────────────────────────────────────────
// AUDIO PIPELINE
// Handles mic access, MediaRecorder chunking, and blob collection.
// ─────────────────────────────────────────────────────────────

function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

export class AudioRecorder {
  constructor(onChunkReady) {
    this.onChunkReady  = onChunkReady; // async (blob) => void
    this.mediaRecorder = null;
    this.audioChunks   = [];
    this.stream        = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._beginChunk();
  }

  async stop() {
    return this._finalizeChunk(/* restart= */ false);
  }

  // Closes the current chunk, fires onChunkReady, then starts a new one.
  async cycle() {
    return this._finalizeChunk(/* restart= */ true);
  }

  _beginChunk() {
    this.audioChunks = [];
    const mimeType   = getSupportedMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
    this.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  _finalizeChunk(restart) {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return Promise.resolve();

    return new Promise(resolve => {
      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          const blob = new Blob(this.audioChunks, { type: this.audioChunks[0]?.type || 'audio/webm' });
          await this.onChunkReady(blob);
        }
        if (restart && this.stream) this._beginChunk();
        resolve();
      };
      this.mediaRecorder.stop();
    });
  }

  release() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mediaRecorder = null;
  }
}
