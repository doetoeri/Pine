import type {CustomLayerInterface,CustomRenderMethodInput,Map as LibreMap} from 'maplibre-gl';
import earcut from 'earcut';
import {active,CATALOG,type Dataset} from './model';
import {temporaryMask,type ProgressiveRun} from './progressive';
import {asset} from './paths';
export const mercator=(lon:number,lat:number):[number,number]=>[(lon+180)/360,(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2];
export const waterUV=(lon:number,lat:number)=>mercator(lon,lat).map(x=>x*40075016.68557849/1800);
const VERT=`attribute vec2 a_pos;attribute float a_start;attribute float a_temporary;attribute float a_recovery;uniform mat4 u_matrix;varying vec2 v_world;varying float v_start;varying float v_temporary;varying float v_recovery;void main(){v_world=a_pos;v_start=a_start;v_temporary=a_temporary;v_recovery=a_recovery;gl_Position=u_matrix*vec4(a_pos,0.0,1.0);}`;
const FRAG=`precision highp float;uniform sampler2D u_normal;uniform float u_year;uniform float u_waves;uniform float u_showTemporary;uniform float u_recover;varying vec2 v_world;varying float v_start;varying float v_temporary;varying float v_recovery;void main(){float permanent=clamp((u_year-v_start)*2.0+0.5,0.0,1.0);float temporary=v_temporary*u_showTemporary*(1.0-permanent);float alpha=permanent*0.83+temporary*0.46;if(alpha<0.002)discard;vec2 uv=v_world*22263.89816;vec3 n=texture2D(u_normal,uv+vec2(u_waves*0.0013,u_waves*0.0007)).rgb*2.0-1.0;vec3 m=texture2D(u_normal,uv*0.5-vec2(u_waves*0.0004,0.0)).rgb*2.0-1.0;vec3 normal=normalize(vec3(n.xy*0.36+m.xy*0.22,1.0));float diffuse=dot(normal,normalize(vec3(-0.4,-0.2,0.9)));float sparkle=pow(max(dot(reflect(-normalize(vec3(-0.4,-0.2,0.9)),normal),vec3(0.0,0.0,1.0)),0.0),25.0)*0.14;vec3 color=mix(vec3(0.105,0.30,0.36),vec3(0.19,0.50,0.57),diffuse*.6)+sparkle; color=mix(color,vec3(0.91,0.58,0.20),temporary*0.8);float recovery=step(v_recovery,u_year)*u_recover*permanent;float hatch=step(0.62,fract((v_world.x+v_world.y)*140000.0));color=mix(color,vec3(0.44,0.74,0.52),recovery*(0.45+hatch*0.35));gl_FragColor=vec4(color*alpha,alpha);}`;
export class WaterLayer implements CustomLayerInterface{
 id='progressive-water';type:'custom'='custom';renderingMode:'2d'='2d';map:LibreMap|null=null;gl:any;program:any;buffer:any;texture:any;count=0;year=2026;waves=0;showTemporary=true;showRecovery=false;error:string|null=null;
 data:Dataset;geo:any;run:ProgressiveRun;vertices:number[]=[];loc:Record<string,any>={};frameYear=-1;
 constructor(data:Dataset,geo:any,run:ProgressiveRun){this.data=data;this.geo=geo;this.run=run}
 onAdd(map:LibreMap,gl:WebGLRenderingContext|WebGL2RenderingContext){
  this.map=map;this.gl=gl;
  const shader=(kind:number,src:string)=>{const sh=gl.createShader(kind)!;gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(sh)||'Water shader compilation failed');return sh};
  try{
   const program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,VERT));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)||'Water linking failed');this.program=program;
   for(const a of ['a_pos','a_start','a_temporary','a_recovery'])this.loc[a]=gl.getAttribLocation(program,a);
   for(const u of ['u_matrix','u_year','u_waves','u_showTemporary','u_recover','u_normal'])this.loc[u]=gl.getUniformLocation(program,u);
   this.buffer=gl.createBuffer();this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([127,127,255]));
   const image=new Image();image.onload=()=>{if(!this.map)return;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.generateMipmap(gl.TEXTURE_2D);map.triggerRepaint()};image.src=asset('textures/water-normal.png');this.rebuild();
  }catch(e){this.error=String(e);console.warn('Water quality fallback:',this.error)}
 }
 rebuild(){
  const vertices:number[]=[];const f=this.run.frames[Math.max(0,Math.min(74,Math.floor(this.year)-2026))]?.base;
  const transient=temporaryMask(this.data,this.run,this.year);
  this.geo.features.forEach((feature:any,j:number)=>{
   const c=this.data.cells[j];if(!c||!feature.geometry)return;
   const temporary=transient[j];
   const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[];
   for(const poly of polygons){const points:number[]=[],holes:number[]=[];for(let ri=0;ri<poly.length;ri++){if(ri)holes.push(points.length/2);for(const xy of poly[ri])points.push(...mercator(xy[0],xy[1]))}const ids=earcut(points,holes,2);for(const i of ids)vertices.push(points[i*2],points[i*2+1],this.run.firstWet[j],temporary,this.run.recoveryYear[j]);}
  });
  this.vertices=vertices;this.count=vertices.length/5;
  if(this.gl&&this.buffer){const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW)}
  this.frameYear=Math.floor(this.year);
 }
 update(run:ProgressiveRun,time:number,temporary:boolean,recovery:boolean){const changed=run!==this.run;this.run=run;this.year=time;this.waves=time-2026;this.showTemporary=temporary;this.showRecovery=recovery;if(changed||Math.floor(time)!==this.frameYear)this.rebuild();this.map?.triggerRepaint()}
 render(gl:WebGLRenderingContext|WebGL2RenderingContext,args:CustomRenderMethodInput){
  if(this.error||!this.program)return;
  gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  const stride=20;for(const [name,size,offset] of [['a_pos',2,0],['a_start',1,8],['a_temporary',1,12],['a_recovery',1,16]] as const){gl.enableVertexAttribArray(this.loc[name]);gl.vertexAttribPointer(this.loc[name],size,gl.FLOAT,false,stride,offset)}
  gl.uniformMatrix4fv(this.loc.u_matrix,false,args.defaultProjectionData.mainMatrix as Float32List);gl.uniform1f(this.loc.u_year,this.year);gl.uniform1f(this.loc.u_waves,this.waves);gl.uniform1f(this.loc.u_showTemporary,this.showTemporary?1:0);gl.uniform1f(this.loc.u_recover,this.showRecovery?1:0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.loc.u_normal,0);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.TRIANGLES,0,this.count);
  for(const a of ['a_pos','a_start','a_temporary','a_recovery'])gl.disableVertexAttribArray(this.loc[a]);
 }
 onRemove(){if(this.gl){this.gl.deleteBuffer(this.buffer);this.gl.deleteTexture(this.texture);this.gl.deleteProgram(this.program)}this.map=null}
}
