import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

// A real TCP outage also affects fetches made inside Service Workers. Browser
// routing cannot reliably intercept those requests across browser engines.
export async function disconnectableOrigin() {
 const root=fileURLToPath(new URL('../../../', import.meta.url));
 let disconnected=false, rejected=0;
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
 const server=createServer(async(req,res)=>{
  if(disconnected){rejected++;req.socket.destroy();return;}
  try {
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const file=resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
   if(!file.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403);res.end();return;}
   const body=await readFile(file);
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {
  url:`http://127.0.0.1:${server.address().port}`,
  disconnect(){disconnected=true;server.closeAllConnections();},
  reconnect(){disconnected=false;},
  get rejected(){return rejected;},
  async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
 };
}
