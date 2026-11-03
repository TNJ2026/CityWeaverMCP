import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('cold saved texture validates serialized format before GPU load and retains reference ownership',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cw-saved-texture-'));
 try{
  const source=fileURLToPath(new URL('../../src/Editor/SavedTextureValidation.cs',import.meta.url));
  await writeFile(path.join(dir,'Tests.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><Compile Include="${source}"/></ItemGroup></Project>`);
  await writeFile(path.join(dir,'Program.cs'),String.raw`
using System;using System.IO;using CityWeaver;using UnityEngine.Experimental.Rendering;using Colossal.IO.AssetDatabase;
namespace UnityEngine.Experimental.Rendering{public enum GraphicsFormat{None=0,R8G8B8A8_UNorm=8,Unsupported=99}public enum FormatUsage{Sample}}
namespace UnityEngine{public class Texture{public int width=2048,height=2048;}public static class SystemInfo{public static bool IsFormatSupported(GraphicsFormat f,FormatUsage u)=>f==GraphicsFormat.R8G8B8A8_UNorm;}}
namespace Colossal.IO.AssetDatabase{
 public class TextureAsset{
  public GraphicsFormat format;public int Loads,Unloads,Reads;public bool Null,Invalid;public byte[] Bytes;
  public Stream GetReadStream(){Reads++;return new MemoryStream(Bytes);}
  public UnityEngine.Texture Load(int bias){Loads++;format=GraphicsFormat.R8G8B8A8_UNorm;return Null?null:new UnityEngine.Texture{width=Invalid?0:2048};}
  public void Unload(){Unloads++;}
 }
}
namespace CityWeaver{public class QueryException:Exception{public string Code;public QueryException(string c,string m):base(m){Code=c;}}public sealed partial class GameQueryService{public static void Check(TextureAsset a)=>ValidateSavedTexture(a);}}
class Program{
 static void Check(bool b){if(!b)throw new Exception("assertion failed");}
 static byte[] Header(int version=5,int format=8,int width=2048){using var s=new MemoryStream();using var w=new BinaryWriter(s);w.Write((ushort)version);w.Write((ushort)width);w.Write((ushort)2048);if(version>=4)w.Write((ushort)1);w.Write((byte)12);if(version>=3)w.Write((byte)format);else w.Write("R8G8B8A8_UNorm");return s.ToArray();}
 static void Reject(TextureAsset a,string code){try{GameQueryService.Check(a);}catch(QueryException e){Check(e.Code==code);return;}throw new Exception("Invalid texture admitted");}
 static void Main(){
  // Models cold-discovered after process restart have None metadata despite a valid RGBA8 file.
  var cold=new TextureAsset{Bytes=Header()};GameQueryService.Check(cold);Check(cold.Reads==1&&cold.Loads==1&&cold.Unloads==1);
  GameQueryService.Check(cold);Check(cold.Reads==1&&cold.Loads==2&&cold.Unloads==2);
  for(int version=1;version<=5;version++){var a=new TextureAsset{Bytes=Header(version)};GameQueryService.Check(a);Check(a.Loads==1&&a.Unloads==1);}
  var unsupported=new TextureAsset{Bytes=Header(format:99)};Reject(unsupported,"TEXTURE_GPU_FORMAT_UNSUPPORTED");Check(unsupported.Loads==0&&unsupported.Unloads==0);
  var bad=new TextureAsset{Bytes=Header(width:0)};Reject(bad,"TEXTURE_HEADER_INVALID");Check(bad.Loads==0);
  var future=new TextureAsset{Bytes=Header(version:6)};Reject(future,"TEXTURE_HEADER_UNSUPPORTED");Check(future.Loads==0);
  var missing=new TextureAsset{format=GraphicsFormat.R8G8B8A8_UNorm,Null=true};Reject(missing,"TEXTURE_GPU_LOAD_FAILED");Check(missing.Loads==1&&missing.Unloads==1);
  var invalid=new TextureAsset{format=GraphicsFormat.R8G8B8A8_UNorm,Invalid=true};Reject(invalid,"TEXTURE_GPU_LOAD_FAILED");Check(invalid.Unloads==1);
  try{GameQueryService.Check(new TextureAsset{Bytes=new byte[]{5,0}});throw new Exception("Truncated header admitted");}catch(EndOfStreamException){}
  Console.WriteLine("Cold texture validation verified");
 }
}`);
  assert.match(execFileSync('dotnet',['run','--project',path.join(dir,'Tests.csproj')],{encoding:'utf8',timeout:120000}),/Cold texture validation verified/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
