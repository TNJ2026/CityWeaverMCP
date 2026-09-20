import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function readToolMedia(result) {
  const data = result.structuredContent?.data;
  const artifact = data?.artifact_path ? data : data?.render;
  if (artifact?.artifact_path) {
    const bytes = await readFile(artifact.artifact_path);
    if (artifact.sha256 && createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Artifact integrity check failed.');
    return bytes;
  }
  const media = result.content?.find(item => item.type === 'image' || item.type === 'resource');
  if (media?.type === 'image') return Buffer.from(media.data, 'base64');
  if (typeof media?.resource?.text === 'string') return Buffer.from(media.resource.text, 'utf8');
  throw new Error('Tool returned neither a local artifact nor supported embedded media.');
}
