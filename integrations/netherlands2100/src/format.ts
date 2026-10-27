export const number=(n:number,d=0)=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}).format(n);
export const people=(n:number)=>Math.abs(n)>=10000?`${number(n/10000,1)}만 명`:`${number(n)}명`;
/** Internal currency is EUR billions. 1 billion = 10 Korean eok. */
export const money=(n:number)=>Math.abs(n)>=.1?`${number(n*10,1)}억 유로`:`${number(n*1e9)}유로`;
export const signed=(n:number,format:(v:number)=>string)=>`${n>0?'+':n<0?'−':''}${format(Math.abs(n))}`;
