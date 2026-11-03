import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP initialize reports the companion package version without a game connection', {timeout:30000}, async t=>{
  const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const temporary=await mkdtemp(path.join(tmpdir(),'cityweaver-server-info-'));
  const client=new Client({name:'server-info-regression',version:'1.0.0'});
  t.after(async()=>{try{await client.close();}finally{await rm(temporary,{recursive:true,force:true});}});
  await client.connect(new StdioClientTransport({
    command:process.execPath,
    args:[fileURLToPath(new URL('../server.mjs',import.meta.url))],
    env:{...process.env,CSII_BRIDGE_FILE:path.join(temporary,'missing-bridge.json'),CITYWEAVER_PLANNING_STORE:path.join(temporary,'plans')},
    stderr:'pipe'
  }));
  assert.equal(client.getServerVersion().name,'cities-skylines2');
  assert.equal(client.getServerVersion().version,metadata.version);
  const {tools}=await client.listTools();
  const available=new Set(tools.map(tool=>tool.name));
  for(const name of ['preview_road_policies','list_vehicle_models','get_vehicle_model','preview_vehicle_replacement','apply_vehicle_replacement','get_vehicle_replacement_operation','restore_vehicle_replacement','cancel_vehicle_replacement']) {
    assert.ok(available.has(name),`Generic API was removed with custom assets: ${name}`);
  }
});
