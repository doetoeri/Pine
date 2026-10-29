import {useEffect,useId,useMemo,useRef,useState,type HTMLAttributes} from 'react';
import {getSvgPath} from 'figma-squircle';

interface Props extends HTMLAttributes<HTMLDivElement>{tone?:'blue'|'paper';reverse?:boolean;clip?:boolean;radius?:number}

/** Figma-compatible corner smoothing. The SVG only paints the supplied UI
 * surface; all text, controls and geographic data remain real DOM/canvas. */
export function SmoothPanel({children,className='',tone='paper',reverse=false,clip=false,radius=40,style,...rest}:Props){
 const ref=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:0,height:0,unit:1});
 const id=useId().replace(/:/g,'');
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  const observer=new ResizeObserver(([entry])=>{
   const unit=parseFloat(getComputedStyle(document.documentElement).fontSize)/18;
   const width=entry.borderBoxSize[0]?.inlineSize??node.clientWidth,height=entry.borderBoxSize[0]?.blockSize??node.clientHeight;
   setSize(old=>old.width===width&&old.height===height&&old.unit===unit?old:{width,height,unit});
  });observer.observe(node);return()=>observer.disconnect();
 },[]);
 const path=useMemo(()=>size.width&&size.height?getSvgPath({width:size.width,height:size.height,cornerRadius:radius*size.unit,cornerSmoothing:.6,preserveSmoothing:true}):'', [size,radius]);
 return <div ref={ref} className={`smooth-panel ${className}`} style={{...style,...(path?{borderRadius:0}:{}),...(clip&&path?{clipPath:`path('${path}')`}:{})}} data-surface={tone} data-corner-radius={radius} data-corner-smoothing="0.6" {...rest}>
  <svg className="panel-paint" width="100%" height="100%" aria-hidden="true" focusable="false">
   <defs>
    <linearGradient id={`${id}-gradient`} x1="0" y1={reverse?'1':'0'} x2="0" y2={reverse?'0':'1'}>
     <stop offset="0%" stopColor="#0067E2"/><stop offset="100%" stopColor="#D0E6FF"/>
    </linearGradient>
    <filter id={`${id}-inner`} x="-10%" y="-20%" width="120%" height="140%" colorInterpolationFilters="sRGB">
     <feOffset in="SourceAlpha" dx="0" dy={10*size.unit} result="offset"/>
     <feGaussianBlur in="offset" stdDeviation={5*size.unit} result="blur"/>
     <feComposite in="SourceAlpha" in2="blur" operator="out" result="inner"/>
     <feFlood floodColor="#D0E6FF" floodOpacity="0.5"/>
     <feComposite in2="inner" operator="in"/>
     <feComposite in2="SourceGraphic" operator="over"/>
    </filter>
   </defs>
   {path&&<path d={path} fill={tone==='blue'?`url(#${id}-gradient)`:'#FFFFFF'} filter={tone==='blue'?`url(#${id}-inner)`:undefined}/>}
  </svg>
  {children}
 </div>;
}
