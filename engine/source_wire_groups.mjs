// A V3 WIRE is an electrical group, not merely a visual polyline. Source import
// does not reliably merge distinct groups at coincident endpoints. Group before
// serializing; don't compensate by emitting supposedly hidden NET attributes.
export function groupConnectedWires(wires) {
  const segments=[];
  for(const [index,w] of wires.entries()){
    if(typeof w.net!=='string'||!w.net)throw new Error('Wire needs an intended net role');
    if(!Array.isArray(w.line)||w.line.length<4||w.line.length%2)throw new Error('Invalid wire polyline');
    for(let i=0;i+3<w.line.length;i+=2){
      const xy=w.line.slice(i,i+4);
      if(!xy.every(Number.isFinite))throw new Error('Invalid wire coordinate');
      if(xy[0]!==xy[2]&&xy[1]!==xy[3])throw new Error('Diagonal wire');
      if(xy[0]===xy[2]&&xy[1]===xy[3])throw new Error('Zero-length wire');
      segments.push({net:w.net,wireIndex:index,xy});
    }
  }
  const parent=segments.map((_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const on=(x,y,s)=>s[0]===s[2]?x===s[0]&&y>=Math.min(s[1],s[3])&&y<=Math.max(s[1],s[3]):y===s[1]&&x>=Math.min(s[0],s[2])&&x<=Math.max(s[0],s[2]);
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j],[ax,ay,bx,by]=a.xy,[cx,cy,dx,dy]=b.xy;
    const contact=on(ax,ay,b.xy)||on(bx,by,b.xy)||on(cx,cy,a.xy)||on(dx,dy,a.xy)
      ||(ax===bx&&cy===dy&&on(ax,cy,a.xy)&&on(ax,cy,b.xy))
      ||(ay===by&&cx===dx&&on(cx,ay,a.xy)&&on(cx,ay,b.xy));
    if(!contact)continue;
    if(a.net!==b.net)throw new Error('Different intended nets touch');
    parent[find(i)]=find(j);
  }
  const groups=new Map();
  for(let i=0;i<segments.length;i++){
    const key=find(i),s=segments[i];
    if(!groups.has(key))groups.set(key,{net:s.net,segments:[],wireIndices:[]});
    const group=groups.get(key);group.segments.push(s.xy);
    if(!group.wireIndices.includes(s.wireIndex))group.wireIndices.push(s.wireIndex);
  }
  return [...groups.values()];
}
