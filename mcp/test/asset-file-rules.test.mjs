import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('asset inputs enforce bounded local projects and decode true-color TGA origins/RLE', async()=>{
  const root=await realpath(tmpdir());const dir=await mkdtemp(path.join(root,'cityweaver-asset-files-'));
  try{
    const rules=fileURLToPath(new URL('../../src/Editor/AssetFileRules.cs',import.meta.url));
    const policy=fileURLToPath(new URL('../../src/Editor/AssetImportPolicy.cs',import.meta.url));
    const uvFit=fileURLToPath(new URL('../../src/Editor/TextureUvFitRules.cs',import.meta.url));
    const obj=fileURLToPath(new URL('../../src/Editor/ObjMeshRules.cs',import.meta.url));
    await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${rules}"/><Compile Include="${obj}"/><Compile Include="${policy}"/><Compile Include="${uvFit}"/></ItemGroup></Project>`);
    await writeFile(path.join(dir,'Program.cs'),`using System;using System.IO;using System.Linq;using CityWeaver;
class Program {
 static int checks;static void Check(bool ok,string label){checks++;if(!ok)throw new Exception(label);}static void Reject(Action action){bool rejected=false;try{action();}catch(ArgumentException){rejected=true;}Check(rejected,"invalid input accepted");}
 static byte[] Tga(byte[] pixels,int bits=24,byte origin=0,byte type=2){var d=new byte[18+pixels.Length];d[2]=type;d[12]=2;d[14]=2;d[16]=(byte)bits;d[17]=origin;Array.Copy(pixels,0,d,18,pixels.Length);return d;}
 static void Main(){
  byte[] red=new byte[]{0,0,255},green=new byte[]{0,255,0},blue=new byte[]{255,0,0},white=new byte[]{255,255,255};
  var raw=red.Concat(green).Concat(blue).Concat(white).ToArray();
  foreach(byte origin in new byte[]{0,16,32,48}){
   var decoded=AssetFileRules.DecodeTga(Tga(raw,origin:origin),out int w,out int h);Check(w==2&&h==2,"dimensions");
   int x=(origin&16)!=0?1:0,y=(origin&32)!=0?1:0,index=(y*2+x)*4;Check(decoded[index]==255&&decoded[index+1]==0&&decoded[index+2]==0&&decoded[index+3]==255,"TGA origin/BGR incorrect");
  }
  var rle=AssetFileRules.DecodeTga(Tga(new byte[]{131,1,2,3},type:10),out _,out _);Check(Enumerable.Range(0,4).All(i=>rle[i*4]==3&&rle[i*4+3]==255),"RLE repeat");
  var literal=AssetFileRules.DecodeTga(Tga(new byte[]{3}.Concat(raw).ToArray(),type:10),out _,out _);Check(literal[0]==255&&literal[8+2]==255,"RLE raw");
  var alpha=AssetFileRules.DecodeTga(Tga(new byte[]{0,0,255,7,0,255,0,8,255,0,0,9,255,255,255,10},bits:32),out _,out _);Check(alpha[3]==7&&alpha[15]==10,"alpha lost");
  Reject(()=>AssetFileRules.DecodeTga(Tga(new byte[]{132,1,2,3},type:10),out _,out _));
  Reject(()=>AssetFileRules.DecodeTga(Tga(new byte[]{131,1},type:10),out _,out _));
  Reject(()=>AssetFileRules.DecodeTga(Tga(raw,bits:16),out _,out _));
  var mapped=Tga(raw);mapped[1]=1;Reject(()=>AssetFileRules.DecodeTga(mapped,out _,out _));
  Reject(()=>AssetFileRules.DecodeTga(Tga(raw,origin:64),out _,out _));
  var id=Tga(raw);id[0]=255;Reject(()=>AssetFileRules.DecodeTga(id,out _,out _));
  Reject(()=>AssetFileRules.ImageSize(new byte[2],".png",out _,out _));
  Reject(()=>AssetFileRules.ImageSize(raw,".jpg",out _,out _));
  Reject(()=>AssetFileRules.Dimensions(0,4));Reject(()=>AssetFileRules.Dimensions(8193,1));Reject(()=>AssetFileRules.Dimensions(8192,8192));
  AssetFileRules.Dimensions(4096,4096);
  var png=new byte[33];new byte[]{137,80,78,71,13,10,26,10}.CopyTo(png,0);new byte[]{73,72,68,82}.CopyTo(png,12);png[19]=2;png[23]=3;
  AssetFileRules.ImageSize(png,".png",out var pw,out var ph);Check(pw==2&&ph==3,"PNG big endian");
  Reject(()=>AssetFileRules.LocalPath("relative.obj",false));
  var project=Path.Combine(AppContext.BaseDirectory,"inputs");Directory.CreateDirectory(project);var model=Path.Combine(project,"Mesh.obj");File.WriteAllText(model,"v 0 0 0");
  var before=AssetFileRules.Scan(project);Check(before.Count==1,"model scan");Check(AssetFileRules.Same(before,AssetFileRules.Scan(project)),"same snapshot");
  File.AppendAllText(model,"\\nv 1 0 0");Check(!AssetFileRules.Same(before,AssetFileRules.Scan(project)),"changed content ignored");
  File.WriteAllText(Path.Combine(project,"Mesh.mtl"),"newmtl Test");Check(!AssetFileRules.Same(before,AssetFileRules.Scan(project)),"added dependency ignored");
  File.WriteAllText(Path.Combine(project,"bad.exe"),"x");Reject(()=>AssetFileRules.Scan(project));File.Delete(Path.Combine(project,"bad.exe"));
  for(int i=0;i<255;i++)File.WriteAllText(Path.Combine(project,"Tex"+i+".png"),"x");Reject(()=>AssetFileRules.Scan(project));
  Check(AssetFileRules.VtLayerOffset(0,3,2)==3&&AssetFileRules.VtLayerOffset(1,2,2)==6,"VT layers aliased");
  Reject(()=>AssetFileRules.VtLayerOffset(-1,0,1));Reject(()=>AssetFileRules.VtLayerOffset(0,4,1));
  var native=AssetFileRules.NativePath(project);Check(!native.Contains((char)92)&&Directory.Exists(native),"native importer separator mismatch");
  Check(AssetImportPolicy.Context("Game","Game",true,true,true,false),"city imports denied");
  Check(AssetImportPolicy.Context("Editor","Editor",true,true,true,false),"editor regression");
  Check(!AssetImportPolicy.Context("Game","Editor",true,true,true,false),"mode change ignored");
  Check(!AssetImportPolicy.Context("Game","Game",false,true,true,false),"old session accepted");
  Check(!AssetImportPolicy.Context("Game","Game",true,false,true,false),"destroyed world accepted");
  Check(!AssetImportPolicy.Context("Game","Game",true,true,false,false),"unpaused import accepted");
  Check(!AssetImportPolicy.Context("Game","Game",true,true,true,true),"loading import accepted");
  Check(!AssetImportPolicy.Context("MainMenu","MainMenu",true,true,true,false),"main menu import accepted");
  var full=TextureUvFitRules.Contain(0,0,1,1,2,200,100);Check(full.SequenceEqual(new float[]{0,0,1,1}),"full UV fit changed aspect");
  var atlas=TextureUvFitRules.Contain(.25f,.5f,.75f,1,2,100,100);Check(atlas.SequenceEqual(new float[]{.375f,.5f,.625f,1}),"physical aspect letterbox wrong");
  var tall=TextureUvFitRules.Contain(0,0,1,.5f,1,200,100);Check(tall.SequenceEqual(new float[]{0,.125f,1,.375f}),"atlas vertical fit wrong");
  Reject(()=>TextureUvFitRules.Contain(-.1f,0,1,1,1,1,1));Reject(()=>TextureUvFitRules.Contain(0,0,2,1,1,1,1));
  Reject(()=>TextureUvFitRules.Contain(0,0,0,1,1,1,1));Reject(()=>TextureUvFitRules.Contain(0,0,1,1,float.NaN,1,1));
  Reject(()=>TextureUvFitRules.Contain(0,0,1,1,0,1,1));Reject(()=>TextureUvFitRules.Contain(0,0,1,1,1,0,1));
  var checker=new byte[8*8*4];for(int y=0;y<8;y++)for(int x=0;x<8;x++){int i=(y*8+x)*4;checker[i]=(byte)(x*30);checker[i+1]=(byte)(y*30);checker[i+3]=255;}
  var identity=new[]{new float[]{0,0,1,0,1,1,0,0,1,0,1,1},new float[]{0,0,1,1,0,1,0,0,1,1,0,1}};
  Check(TextureUvFitRules.Bake(checker,8,8,identity,new float[]{0,0,1,1}).SequenceEqual(checker),"UV triangle projection changes identity artwork");
  var split=new[]{new float[]{0,0,.25f,0,.25f,1,0,0,.5f,0,.5f,1},new float[]{0,0,.25f,1,0,1,0,0,.5f,1,0,1},new float[]{.5f,0,1,0,1,1,.5f,0,1,0,1,1},new float[]{.5f,0,1,1,.5f,1,.5f,0,1,1,.5f,1}};
  var baked=TextureUvFitRules.Bake(checker,8,8,split,new float[]{0,0,1,1});Check(baked[0]==30&&baked[4]==90&&baked[8]==0&&baked[16]==120&&baked[28]==210,"different UV scales crop/shift artwork");
  var mirrored=new[]{new float[]{1,0,0,0,0,1,0,0,1,0,1,1},new float[]{1,0,0,1,1,1,0,0,1,1,0,1}};
  Check(TextureUvFitRules.Bake(checker,8,8,mirrored,new float[]{0,0,1,1})[0]==210,"mirrored UV orientation ignored");
  Reject(()=>TextureUvFitRules.Bake(checker,8,8,identity.Concat(mirrored).ToArray(),new float[]{0,0,1,1}));
  var letter=TextureUvFitRules.Bake(checker,8,8,identity,new float[]{0,.25f,1,.75f});Check(letter[1]==0&&letter[(7*8)*4+1]==0&&letter[(2*8)*4+1]==30,"physical letterbox mapping crops source");
  var modelName="CityWeaver_"+new string('a',32);var modelPath="ImportedData/CityWeaver/"+new string('a',32);
  Check(AssetImportPolicy.OwnedModel(modelName,modelPath),"local import unrecognized");
  Check(!AssetImportPolicy.OwnedModel(modelName,"Elsewhere/"+new string('a',32)),"foreign asset accepted");
  Check(!AssetImportPolicy.OwnedModel(modelName+"_Mesh",modelPath),"render child accepted as placeable root");
  Check(!AssetImportPolicy.OwnedModel("CityWeaver_"+new string('g',32),modelPath),"invalid model ID accepted");
  var triangle=new[]{"v 0 0 0","v 1 0 0","v 0 1 0","vt 0 0","vt 1 0","vt 0 1","vn 0 0 1","f 1/1/1 2/2/1 3/3/1"};
  var mesh=ObjMeshRules.Parse(triangle).Single();Check(mesh.Indices.Count==3&&mesh.Positions.Count==9,"OBJ triangle");Check(mesh.Normals[2]==-1&&mesh.UVs[3]==1,"OBJ UV/normal");Check(mesh.Positions[3]==0&&mesh.Positions[4]==1,"OBJ winding conversion");Check(mesh.Tangents.All(float.IsFinite),"OBJ tangent nonfinite");
  var bbox=mesh.Bounds();Check(bbox.SequenceEqual(new float[]{0,0,0,1,1,0}),"OBJ descriptor bounds missing");
  Check(mesh.Bounds(2).SequenceEqual(new float[]{0,0,0,2,2,0}),"OBJ bounds scale mismatch");
  Check(AssetFileRules.ValidBounds(0,0,0,8,0,4),"flat geometry rejected");
  Check(!AssetFileRules.ValidBounds(0,0,0,0,0,0),"invisible zero bounds accepted");
  Check(!AssetFileRules.ValidBounds(1,0,0,0,2,2),"inverted bounds accepted");
  Check(!AssetFileRules.ValidBounds(0,0,0,float.NaN,2,2),"nonfinite bounds accepted");
  var negative=ObjMeshRules.Parse(triangle.Take(7).Append("f -3/-3/-1 -2/-2/-1 -1/-1/-1")).Single();Check(mesh.Positions.SequenceEqual(negative.Positions),"OBJ negative index");
  var flat=ObjMeshRules.Parse(new[]{"v 0 0 0","v 1 0 0","v 1 1 0","v 0 1 0","f 1 2 3 4"}).Single();Check(flat.Indices.Count==6&&flat.Tangents.All(float.IsFinite),"OBJ quad/missing normals UV");
  var multi=ObjMeshRules.Parse(triangle.Take(7).Concat(new[]{"usemtl A","f 1 2 3","usemtl B","f 3 2 1"}));Check(multi.Count==2,"OBJ material split");
  Reject(()=>ObjMeshRules.Parse(triangle.Take(7).Append("f 0 2 3")));Reject(()=>ObjMeshRules.Parse(triangle.Take(7).Append("f 1 2 4")));
  Reject(()=>ObjMeshRules.Parse(new[]{"v NaN 0 0"}));Reject(()=>ObjMeshRules.Parse(new[]{"v 0 0 0","f 1 1 1"}));
  Reject(()=>ObjMeshRules.Parse(new[]{"v 0 0 0","v 2 0 0","v 1 .5 0","v 2 2 0","v 0 2 0","f 1 2 3 4 5"}));
  Reject(()=>ObjMeshRules.Parse(new[]{"v 0 0 0","v 1 0 0","v 1 1 0","v 0 1 1","f 1 2 3 4"}));
  Reject(()=>ObjMeshRules.Parse(new[]{"v 0 0 0 1"}));Reject(()=>ObjMeshRules.Parse(new[]{"curv 1 2 3"}));
  Console.WriteLine(checks+" asset file checks passed");
 }
}`);
    let output;try{output=execFileSync(process.env.CITYWEAVER_TEST_DOTNET??'dotnet',['run','--project',path.join(dir,'Tests.csproj')],{encoding:'utf8',timeout:120000});}catch(e){throw new Error(e.stdout+'\n'+e.stderr);}
    assert.match(output,/asset file checks passed/);
  }finally{
    assert.equal(path.dirname(await realpath(dir)),root);
    await rm(dir,{recursive:true,force:true});
  }
});
