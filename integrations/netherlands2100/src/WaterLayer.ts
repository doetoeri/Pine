/** Geographic utilities shared by the map and display-only flood overlay. */
export const mercator=(lon:number,lat:number):[number,number]=>[(lon+180)/360,(1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2];
export const waterUV=(lon:number,lat:number)=>mercator(lon,lat).map(x=>x*40075016.68557849/1800);
