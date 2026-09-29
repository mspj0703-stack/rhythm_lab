import { useEffect, useRef } from "react";
import type { NoteRuntime } from "../types/chart";
import { projection, laneGeometry, TOP_WIDTH_RATIO, BOTTOM_WIDTH_RATIO } from "../engine/highway";

interface Props { notes: NoteRuntime[]; currentTimeSec: number; width: number; height: number; judgeLineY: number; laneCount: number; noteSpeed: number; }
const LANE_COLORS = ["#8f82ff", "#4ce0b1", "#ff845e", "#ff6ca5"];
function roundedRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.lineTo(x+w-rr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+rr);ctx.lineTo(x+w,y+h-rr);ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);ctx.lineTo(x+rr,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-rr);ctx.lineTo(x,y+rr);ctx.quadraticCurveTo(x,y,x+rr,y);ctx.closePath();ctx.fill();}
export function NoteFieldCanvas({notes,currentTimeSec,width,height,judgeLineY,laneCount,noteSpeed}:Props){
 const canvasRef=useRef<HTMLCanvasElement|null>(null);
 useEffect(()=>{const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,width,height);
  const topW=width*TOP_WIDTH_RATIO,bottomW=width*BOTTOM_WIDTH_RATIO,topL=(width-topW)/2,bottomL=(width-bottomW)/2;
  const road=ctx.createLinearGradient(0,0,0,judgeLineY);road.addColorStop(0,"rgba(8,7,18,.38)");road.addColorStop(1,"rgba(3,3,8,.72)");ctx.fillStyle=road;ctx.beginPath();ctx.moveTo(topL,0);ctx.lineTo(topL+topW,0);ctx.lineTo(bottomL+bottomW,judgeLineY);ctx.lineTo(bottomL,judgeLineY);ctx.closePath();ctx.fill();
  ctx.strokeStyle="rgba(255,255,255,.14)";ctx.lineWidth=1;for(let i=0;i<=laneCount;i++){ctx.beginPath();ctx.moveTo(topL+topW*i/laneCount,0);ctx.lineTo(bottomL+bottomW*i/laneCount,judgeLineY);ctx.stroke();}
  ctx.save();ctx.shadowBlur=20;ctx.shadowColor="rgba(220,205,255,.9)";ctx.strokeStyle="rgba(255,255,255,.98)";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(bottomL,judgeLineY);ctx.lineTo(bottomL+bottomW,judgeLineY);ctx.stroke();ctx.restore();
  for(const n of [...notes].sort((a,b)=>b.note.time-a.note.time)){if(n.status!=="pending"&&n.status!=="holding")continue;const head=projection(n.status==="holding"?currentTimeSec:n.note.time,currentTimeSec,judgeLineY,noteSpeed);if(head.p<0)continue;const geo=laneGeometry(n.note.lane,laneCount,width,head.scale);const x=geo.x+geo.laneW*.055,nw=geo.laneW*.89;const color=LANE_COLORS[n.note.lane%4];ctx.shadowColor=color;ctx.shadowBlur=n.note.type==="flick"?24:(n.status==="holding"?22:14);
   if(n.note.type==="hold"){const tail=projection(n.note.time+n.note.duration,currentTimeSec,judgeLineY,noteSpeed);const tgeo=laneGeometry(n.note.lane,laneCount,width,tail.scale);const tx=tgeo.x+tgeo.laneW*.12,tw=tgeo.laneW*.76;const hy=n.status==="holding"?judgeLineY:head.y;ctx.fillStyle=color+"88";ctx.beginPath();ctx.moveTo(tx,tail.y);ctx.lineTo(tx+tw,tail.y);ctx.lineTo(x+nw*.92,hy);ctx.lineTo(x+nw*.08,hy);ctx.closePath();ctx.fill();ctx.fillStyle="rgba(255,255,255,.9)";if(tail.p>=0)roundedRect(ctx,tx,tail.y-3,tw,7,4);ctx.fillStyle=color;roundedRect(ctx,x,hy-10,nw,20,7);ctx.fillStyle="rgba(255,255,255,.88)";roundedRect(ctx,x+5,hy+4,nw-10,3,2);
   }else{const nh=Math.max(11,20*head.scale/.96);ctx.fillStyle=color;roundedRect(ctx,x,head.y-nh/2,nw,nh,Math.max(4,7*head.scale/.96));ctx.fillStyle="rgba(255,255,255,.9)";roundedRect(ctx,x+4,head.y+nh*.18,nw-8,Math.max(2,3*head.scale/.96),2);
    if(n.note.type==="flick"){const cx=x+nw/2,arrow=Math.max(20,32*head.scale/.96);ctx.fillStyle="rgba(255,255,255,.98)";ctx.shadowBlur=28;ctx.beginPath();ctx.moveTo(cx,head.y-arrow*1.35);ctx.lineTo(cx-arrow*.72,head.y-arrow*.28);ctx.lineTo(cx-arrow*.28,head.y-arrow*.28);ctx.lineTo(cx-arrow*.28,head.y+arrow*.42);ctx.lineTo(cx+arrow*.28,head.y+arrow*.42);ctx.lineTo(cx+arrow*.28,head.y-arrow*.28);ctx.lineTo(cx+arrow*.72,head.y-arrow*.28);ctx.closePath();ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,4*head.scale/.96);ctx.stroke();}
   }ctx.shadowBlur=0;
  }
 },[notes,currentTimeSec,width,height,judgeLineY,laneCount,noteSpeed]);
 return <canvas ref={canvasRef} width={width} height={height} style={{display:"block",width:"100%",height:"100%"}}/>;
}
