import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const [toolName, argsPath, outputPath] = process.argv.slice(2);
if (!toolName || !argsPath || !outputPath) {
  throw new Error('Usage: node export-tool-media.mjs <tool> <args.json> <output>');
}

const args = JSON.parse(await readFile(argsPath, 'utf8'));
const client = new Client({ name: 'cityweaver-media-export', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
}));

try {
  const result = await client.callTool({ name: toolName, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent ?? result.content));
  const media = result.content.find(item => item.type === 'image' || item.type === 'resource');
  if (!media) throw new Error(`${toolName} returned no image or embedded resource`);
  if (media.type === 'image') {
    await writeFile(outputPath, Buffer.from(media.data, 'base64'));
  } else if (typeof media.resource?.text === 'string') {
    await writeFile(outputPath, media.resource.text, 'utf8');
  } else {
    throw new Error(`${toolName} returned an unsupported media payload`);
  }
  console.log(JSON.stringify({ output_path: outputPath, result: result.structuredContent }, null, 2));
} finally {
  await client.close();
}
