// Published snapshots are immutable; live status and provider credentials are not.
const snapshot = "\\d{8}T\\d{2}Z-f\\d{3}-\\d+p\\d+(?:-v2)?";
const immutablePath = new RegExp(`^/(?:data/live/${snapshot}/|data/geography/|api/earth/3d/(?:height|pressure|cloud-observation|cloud-convection|cloud-cores|cloud-point|cloud-volume|cloud-shape)/${snapshot}(?:/|$))`);

export function immutableData(url) {
  return immutablePath.test(new URL(url, "http://local/").pathname);
}

/** Keep a few decoded datasets so switching back does not parse megabytes again. */
export class DataLoader {
  constructor(fetcher = fetch, { maxBytes = 128 * 1024 ** 2 } = {}) {
    this.fetcher = fetcher.bind(globalThis);
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.pending = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.requests = 0;
  }
  json(url, timeout = 25000, signal = null) {
    return this.load(url, "json", timeout, signal);
  }

  binary(url, timeout = 25000, signal = null) {
    return this.load(url, "binary", timeout, signal);
  }

  async load(url, format, timeout, signal) {
    signal?.throwIfAborted();
    const address = new URL(url, globalThis.location?.href || "http://local/").href;
    const key = format + ":" + address;
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      this.hits++;
      return cached.value;
    }

    const reusable = immutableData(address);
    // Only callers with identical timeout and cancellation semantics can share work.
    const pendingKey = reusable && !signal ? timeout + ":" + key : null;
    if (pendingKey && this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const read = async () => {
      const deadline = AbortSignal.timeout(timeout);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      this.requests++;
      const response = await this.fetcher(url, {
        cache: reusable ? "default" : "no-store",
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = format === "binary" ? await response.arrayBuffer() : await response.text();
      requestSignal.throwIfAborted();
      const value = format === "binary" ? body : JSON.parse(body);
      if (reusable) this.remember(key, value, format === "binary" ? body.byteLength : body.length * 3);
      return value;
    };

    const request = read();
    if (!pendingKey) return request;
    this.pending.set(pendingKey, request);
    try {
      return await request;
    } finally {
      this.pending.delete(pendingKey);
    }
  }
  remember(key, value, bytes) {
    if (bytes <= this.maxBytes) {
      const previous = this.entries.get(key);
      if (previous) {
        this.bytes -= previous.bytes;
        this.entries.delete(key);
      }
      while (this.bytes + bytes > this.maxBytes && this.entries.size) {
        const oldest = this.entries.keys().next().value;
        this.bytes -= this.entries.get(oldest).bytes;
        this.entries.delete(oldest);
      }
      this.entries.set(key, { value, bytes });
      this.bytes += bytes;
    }
  }
  metrics() {
    return { requests: this.requests, hits: this.hits, entries: this.entries.size, decodedMiB: Math.round(this.bytes / 1024 ** 2) };
  }
}
