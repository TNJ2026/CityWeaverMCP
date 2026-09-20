import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BridgeError } from './bridge-client.mjs';
import { BoundedCache } from './bounded-cache.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
export const contentHash = value => digest(JSON.stringify(canonical(value)));
const defaultRoot = fileURLToPath(new URL('../artifacts/planning-store/', import.meta.url));

// Immutable records and replace-on-write journals survive separate stdio MCP processes.
export class PlanningStore {
  constructor(root = process.env.CITYWEAVER_PLANNING_STORE ?? defaultRoot, { maxCacheBytes = 32 * 1024 * 1024 } = {}) {
    this.root = path.resolve(root);
    this.records = new BoundedCache(maxCacheBytes);
  }
  location(ref) {
    if (!/^(plan|snapshot|evidence|construction)-[a-f0-9]{64}$/.test(ref)) throw new BridgeError('INVALID_REFERENCE', 'Invalid planning reference.');
    return path.join(this.root, `${ref}.json`);
  }
  async put(kind, data) {
    const ref = `${kind}-${contentHash(data)}`;
    const target = this.location(ref);
    await mkdir(this.root, { recursive: true });
    const text = JSON.stringify({ schema_version: 1, kind, data });
    try { await writeFile(target, text, { flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; await this.get(ref); }
    return ref;
  }
  async get(ref) {
    let record, text;
    try { text = await readFile(this.location(ref), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') throw new BridgeError('REFERENCE_NOT_FOUND', 'Planning reference was not found on this host.'); throw e; }
    // Read and hash actual bytes even on hits: detect deletion/tampering, not just mtime changes.
    const immutable = !ref.startsWith('construction-');
    const byteHash = immutable ? digest(text) : null;
    const cached = immutable ? this.records.get(ref) : null;
    if (cached?.byteHash === byteHash) return structuredClone(cached.data);
    if (immutable) this.records.delete(ref);
    record = JSON.parse(text);
    if (record.schema_version !== 1) throw new BridgeError('STORE_VERSION_MISMATCH', 'Unsupported planning record schema.');
    if (!ref.startsWith('construction-') && `${record.kind}-${contentHash(record.data)}` !== ref) throw new BridgeError('STORE_INTEGRITY_ERROR', 'Planning record hash mismatch.');
    if (immutable) this.records.set(ref, { byteHash, data: record.data }, Buffer.byteLength(text) * 4);
    return structuredClone(record.data);
  }
  async save(ref, data) {
    if (!ref.startsWith('construction-')) throw new BridgeError('IMMUTABLE_REFERENCE', 'Only construction journals are mutable.');
    const target = this.location(ref);
    await mkdir(this.root, { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(JSON.stringify({ schema_version: 1, kind: 'construction', data })); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, target);
  }
  async locked(fn) {
    await mkdir(this.root, { recursive: true });
    const target = path.join(this.root, 'construction.lock');
    let handle;
    try { handle = await open(target, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw new BridgeError('CONSTRUCTION_BUSY', 'A planning construction writer holds the store lock. After a crash, inspect journals before removing the stale lock.'); throw e; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })); return await fn(); }
    finally { await handle.close(); await unlink(target); }
  }
  async artifact(text, extension = 'html') {
    const sha256 = digest(text), byte_size = Buffer.byteLength(text);
    const directory = path.join(this.root, 'artifacts');
    await mkdir(directory, { recursive: true });
    const artifact_path = path.join(directory, `${sha256}.${extension}`);
    await writeFile(artifact_path, text, { flag: 'w' });
    return { artifact_path, artifact_uri: pathToFileURL(artifact_path).href, byte_size, sha256, mime_type: extension === 'html' ? 'text/html' : 'image/svg+xml', access: 'local_host' };
  }
  async read(ref, fields = [], offset = 0, limit = 20) {
    let value = await this.get(ref);
    for (const field of fields) {
      if (['__proto__', 'constructor', 'prototype'].includes(field) || value == null || !Object.hasOwn(value, field)) throw new BridgeError('FIELD_NOT_FOUND', 'Requested record field does not exist.');
      value = value[field];
    }
    // Never implicitly expand large nested objects or HTML into a tool response.
    const small = x => Array.isArray(x) ? { type: 'array', count: x.length } : x && typeof x === 'object' ? { type: 'object', fields: Object.keys(x) } : typeof x === 'string' && x.length > 2000 ? { type: 'string', length: x.length, preview: x.slice(0, 2000) } : x;
    if (Array.isArray(value)) return { ref, fields, count: value.length, offset, next_offset: offset + limit < value.length ? offset + limit : null, items: value.slice(offset, offset + limit).map(small) };
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return { ref, fields, count: entries.length, offset, next_offset: offset + limit < entries.length ? offset + limit : null, data: Object.fromEntries(entries.slice(offset, offset + limit).map(([k, v]) => [k, small(v)])) };
    }
    return { ref, fields, value: small(value) };
  }
}

export function compactResult(value) {
  if (Array.isArray(value)) return value.length > 20 ? { count: value.length, items: value.slice(0, 20).map(compactResult), truncated: true } : value.map(compactResult);
  if (!value || typeof value !== 'object') return value;
  const heavy = new Set(['plan', 'annotated_plan', 'batches', 'execution_order', 'roads', 'candidate_rankings', 'performance', 'curve_segments', 'segments', 'objects', 'geometry_points', 'native_args']);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'virtual_sandbox' && item) return [key, { state: item.state, errors: compactResult(item.errors ?? []), warnings: compactResult(item.warnings ?? []), stored_in_evidence: true }];
    return [key, heavy.has(key) && item && typeof item === 'object' ? { stored_in_evidence: true, ...(Array.isArray(item) ? { count: item.length } : {}) } : compactResult(item)];
  }));
}
