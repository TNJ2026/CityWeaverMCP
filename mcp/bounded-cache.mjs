// Values are private to the owner; callers must clone mutable JSON at boundaries.
export class BoundedCache {
  constructor(maxBytes = 32 * 1024 * 1024, maxEntries = 128) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    this.entries = new Map(); this.bytes = 0;
    this.hits = 0; this.misses = 0; this.evictions = 0;
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) { this.misses++; return undefined; }
    this.entries.delete(key); this.entries.set(key, entry); this.hits++;
    return entry.value;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  set(key, value, bytes) {
    this.delete(key);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      this.delete(this.entries.keys().next().value); this.evictions++;
    }
  }
  inspect() { return { entries: this.entries.size, estimated_bytes: this.bytes, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
}
