import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const file='artifacts/heliport-width104-imports.json';
const records=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];
function q(n,a){const r=JSON.parse(execFileSync(process.execPath,['mcp/query.mjs',n,JSON.stringify(a)],{encoding:'utf8',maxBuffer:8*1024*1024}));if(!r.ok)throw Error(JSON.stringify(r));return r;}
function save(){fs.writeFileSync(file,JSON.stringify(records,null,2));}
for(let i=0;i<6;i++){
 if(records[i]?.data?.state==='completed')continue;
 if(records[i])throw Error('Inspect existing operation before retry');
 const request_id=`heliport-width104-13659-${i}`;
 const preview=q('preview_model_import',{request_id,source_directory:path.resolve(`assets_game_import/heliport-width104/Part${i}`),preset:'static_object'});
 records[i]=preview;save();
 if(preview.data.state!=='preview_ready'||!preview.data.can_commit)throw Error(JSON.stringify(preview));
 records[i]=q('apply_asset_file_operation',{operation_id:preview.data.operation_id,request_id,max_input_bytes:preview.data.input_bytes});save();
 for(let t=0;t<90;t++){
  await new Promise(r=>setTimeout(r,1000));
  const r=q('get_asset_file_operation',{operation_id:preview.data.operation_id});records[i]=r;save();
  if(r.data.state==='completed'){console.log(i,r.data.results[0].render_meshes[0].name);break;}
  if(r.data.error||r.data.state==='outcome_unknown')throw Error(JSON.stringify(r));
 }
 if(records[i].data.state!=='completed')throw Error('Import timeout: inspect operation');
}
