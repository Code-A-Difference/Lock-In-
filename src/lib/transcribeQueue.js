/**
 * The pieces of a lecture waiting to be transcribed.
 *
 * They go out in order, a couple at a time, and a piece that fails is never
 * given up on quickly: the transcription service is shared (a whole school
 * records classes through the same few keys) and is sometimes busy for a
 * minute, so a failure backs off for everyone in the queue together, 4 s,
 * then 8, 16… up to a minute and a half, and the next piece is the one that
 * tests whether it's back. Nothing hammers a busy service, and nothing waits
 * behind a request that hung: each has a time limit.
 *
 * Plain JavaScript with the clock and the timers passed in, so
 * tests/transcribeQueue.test.mjs runs it in Node.
 */
export class TranscribeQueue {
  /**
   * `send(piece, signal)` returns the text, or rejects; an error with `retryable: false`
   * is given up on at once (the piece itself is the problem), any other is tried again,
   * and `retryAfterMs` on it is honoured. `onResult(piece, text)` and `onFail(piece, error)`
   * are told as each piece settles; `onChange()` whenever the counts change.
   */
  constructor({
    send, onResult, onFail, onChange, concurrency = 2, maxAttempts = 10, baseDelay = 4000, maxDelay = 90000, timeout = 70000,
    now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), random = Math.random,
  } = {}) {
    Object.assign(this, { send, onResult, onFail, onChange, concurrency, maxAttempts, baseDelay, maxDelay, timeout, now, setTimer, clearTimer, random });
    this.items = new Map();       // id -> { id, lectureId, start, priority, attempts, state: 'waiting' | 'active' | 'failed', error, ...the piece }
    this.running = 0;
    this.blockedUntil = 0;        // while the service is struggling, nothing is sent before this
    this.fails = 0;               // failures in a row, which sets how long to wait
    this.lastDone = now();
    this.lastError = '';
    this.timer = null;
    this.paused = false;
    this.waiters = [];
  }

  /** Queue a piece ({ id, lectureId, start, ...whatever `send` needs }). A piece already queued is left alone; one that had failed gets another go. */
  add(piece) {
    const old = this.items.get(piece.id);
    if (old && old.state !== 'failed') return;
    this.items.set(piece.id, { priority: 0, ...piece, attempts: 0, state: 'waiting', error: '' });
    this._pump();
    this._changed();
  }

  /** Try the failed pieces again (all, or one lecture's), now. */
  retry(lectureId) {
    for (const it of this.items.values()) {
      if (it.state === 'failed' && (!lectureId || it.lectureId === lectureId)) { it.state = 'waiting'; it.attempts = 0; it.error = ''; }
    }
    this.blockedUntil = 0;
    this.fails = 0;
    this._pump();
    this._changed();
  }

  /** The connection is back, or the person is looking: stop waiting out the backoff. */
  kick() {
    this.blockedUntil = 0;
    this._pump();
  }

  pause() { this.paused = true; this.clearTimer(this.timer); this.timer = null; }
  resume() { this.paused = false; this._pump(); }

  /** Forget a lecture's pieces (it was deleted). Requests already in flight finish, and their results are dropped. */
  remove(lectureId) {
    for (const [id, it] of this.items) if (it.lectureId === lectureId) { it.gone = true; if (it.state !== 'active') this.items.delete(id); }
    this._changed();
  }

  has(id) { return this.items.has(id); }

  /** { waiting, active, failed, nextAt, error } for one lecture, or for all of them. `nextAt` is when it will next try, 0 if now. */
  stats(lectureId) {
    const s = { waiting: 0, active: 0, failed: 0, nextAt: 0, error: this.lastError };
    for (const it of this.items.values()) if (!lectureId || it.lectureId === lectureId) s[it.state]++;
    if (s.waiting && this.blockedUntil > this.now()) s.nextAt = this.blockedUntil;
    return s;
  }

  /**
   * Resolves { outcome: 'done', failed } once none of a lecture's pieces are waiting or in flight,
   * or { outcome: 'stalled' } if `stallMs` pass with nothing getting through. It does not stop the queue.
   */
  settled(lectureId, { stallMs = 45000 } = {}) {
    return new Promise((resolve) => {
      const w = { lectureId, stallMs, since: this.now(), resolve, timer: null };
      this.waiters.push(w);
      this._check(w);
    });
  }

  _check(w) {
    const s = this.stats(w.lectureId);
    let outcome = null;
    if (!s.waiting && !s.active) outcome = { outcome: 'done', failed: s.failed };
    else if (this.now() - Math.max(this.lastDone, w.since) >= w.stallMs) outcome = { outcome: 'stalled' };
    if (outcome) {
      this.clearTimer(w.timer);
      this.waiters = this.waiters.filter(x => x !== w);
      w.resolve(outcome);
      return;
    }
    this.clearTimer(w.timer);
    const left = w.stallMs - (this.now() - Math.max(this.lastDone, w.since));
    w.timer = this.setTimer(() => this._check(w), Math.max(250, left + 5));
  }

  _changed() {
    try { this.onChange?.(); } catch (_) { /* a listener's mistake isn't the queue's */ }
    for (const w of [...this.waiters]) this._check(w);
  }

  _next() {
    let best = null;
    for (const it of this.items.values()) {
      if (it.state !== 'waiting') continue;
      if (!best || it.priority > best.priority || (it.priority === best.priority && (it.lectureId < best.lectureId || (it.lectureId === best.lectureId && it.start < best.start)))) best = it;
    }
    return best;
  }

  _pump() {
    this.clearTimer(this.timer);
    this.timer = null;
    if (this.paused) return;
    const t = this.now();
    if (t < this.blockedUntil) {
      if ([...this.items.values()].some(i => i.state === 'waiting')) this.timer = this.setTimer(() => this._pump(), this.blockedUntil - t + 10);
      return;
    }
    while (this.running < this.concurrency) {
      const next = this._next();
      if (!next) break;
      this._run(next);
    }
  }

  async _run(it) {
    it.state = 'active';
    this.running++;
    this._changed();
    const ctl = new AbortController();
    const cutoff = this.setTimer(() => ctl.abort(), this.timeout);
    let text = null;
    let err = null;
    try { text = await this.send(it, ctl.signal); } catch (e) { err = e || new Error('Transcription failed.'); }
    this.clearTimer(cutoff);
    this.running--;
    if (it.gone) { this.items.delete(it.id); this._pump(); this._changed(); return; }
    if (!err) {
      this.items.delete(it.id);
      this.fails = 0;
      this.blockedUntil = 0;
      this.lastDone = this.now();
      this.lastError = '';
      try { await this.onResult?.(it, String(text ?? '')); } catch (_) { /* saving it is the owner's concern */ }
    } else {
      const message = err.name === 'AbortError' ? 'The transcription service took too long.' : (err.message || 'Transcription failed.');
      it.attempts++;
      it.error = message;
      this.lastError = message;
      const retryable = err.retryable !== false;
      if (retryable) {                         // the service is struggling, whichever piece found out: everyone waits
        this.fails++;
        const wait = Math.min(this.maxDelay, this.baseDelay * 2 ** (this.fails - 1)) * (0.75 + this.random() * 0.5);
        this.blockedUntil = this.now() + Math.max(wait, Number(err.retryAfterMs) || 0);
      }
      if (!retryable || it.attempts >= this.maxAttempts) {
        it.state = 'failed';
        try { this.onFail?.(it, err); } catch (_) { /* as above */ }
      } else {
        it.state = 'waiting';
      }
    }
    this._pump();
    this._changed();
  }
}
