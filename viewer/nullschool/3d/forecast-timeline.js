// Only the selected, fully prepared frame starts the next dwell interval.
export class ForecastTimeline {
  constructor(load, render, dwell = 2000, ready = () => false) {
    this.load = load;
    this.ready = ready;
    this.render = render;
    this.error = null;
    this.dwell = dwell;
    this.rate = 1;
    this.dwellStarted = 0;
    this.frames = [];
    this.current = null;
    this.latest = null;
    this.following = true;
    this.playing = false;
    this.pending = null;
    this.queued = null;
    this.timer = null;
  }
  catalog(frames, latest, displayed = latest?.id) {
    this.latest = latest;
    this.frames = frames;
    if (!latest) {
      this.current = displayed;
      this.pause();
      return;
    }
    const exists = id => this.frames.some(frame => frame.id === id);
    if (!this.current) this.current = displayed;
    if (this.frames.length<2 && this.playing) this.pause();
    if (!exists(this.queued?.id || this.pending?.id || this.current)) {
      return this.live();
    }
    if (this.following && this.current !== latest.id && this.pending?.id !== latest.id) {
      return this.select(latest);
    }
    this.render();
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending?.controller.abort();
    this.pending = null;
    this.queued = null;
  }
  pause() {
    this.error = null;
    this.playing = false;
    this.cancel();
    this.render();
  }
  seek(index, {scrubbing = false} = {}) {
    const frame = this.frames[index];
    if (!frame) return;
    this.following = false;
    this.playing = false;
    this.error = null;
    // Native range inputs send both input and change for the same selection.
    if (this.pending?.id === frame.id) {
      this.render();
      return;
    }
    if (scrubbing && frame.id !== this.current && !this.ready(frame)) {
      // Sample the newest thumb position at most once per window, even if
      // pointer events keep arriving. Superseded loads lose ownership at once.
      if (!this.queued) {
        this.cancel();
        this.timer = setTimeout(() => this.select(this.queued), 120);
      }
      this.queued = frame;
      this.render();
      return;
    }
    return this.select(frame);
  }
  scheduleNext(progress = 0) {
    clearTimeout(this.timer);
    const duration = this.dwell / this.rate;
    this.dwellStarted = performance.now() - progress * duration;
    this.timer = setTimeout(() => this.next(), (1 - progress) * duration);
  }
  setRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0 || rate === this.rate) return;
    const waiting = this.playing && this.timer !== null;
    const progress = waiting ? Math.min(1, Math.max(0, (performance.now() - this.dwellStarted) * this.rate / this.dwell)) : 0;
    this.rate = rate;
    if (waiting) this.scheduleNext(progress);
    this.render();
  }
  live() {
    this.pause();
    this.following = true;
    return this.select(this.latest);
  }
  play() {
    if (this.frames.length < 2 || this.playing) return;
    this.cancel();
    this.following = false;
    this.playing = true;
    return this.next();
  }
  next() {
    const index = this.frames.findIndex(frame => frame.id === this.current);
    return this.select(this.frames[(index + 1) % this.frames.length]);
  }
  async select(frame) {
    this.error = null;
    this.cancel();
    if (!frame) return;
    if (this.playing && this.frames.length < 2) this.playing = false;
    if (this.current !== frame.id) {
      const controller = new AbortController();
      this.pending = {id: frame.id, controller};
      this.render();
      try {
        await this.load(frame, controller.signal);
        if (controller.signal.aborted) return;
        this.current = frame.id;
      } catch (error) {
        if (controller.signal.aborted) return;
        controller.abort();
        this.playing = false;
        this.error = error;
      } finally {
        if (this.pending?.controller === controller) this.pending = null;
      }
    }
    this.render();
    if (this.playing) this.scheduleNext();
  }
}
