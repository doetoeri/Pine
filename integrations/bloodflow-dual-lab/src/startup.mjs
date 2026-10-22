// Also emitted as a dependency-free classic script, so a failed ESM graph can report its own failure.
export function startApplication({window,document,load,timeoutMs=10000,setTimer=setTimeout,clearTimer=clearTimeout}){
 const host=document.getElementById('app');let phase='loading',timer;
 const panel=()=>{
  let el=document.getElementById('startup-status');
  if(!el){el=document.createElement('section');el.id='startup-status';host.prepend(el);}
  el.className='startup-panel';return el;
 };
 const text=(parent,tag,value)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
 const showProblem=(failed,error)=>{
  const el=panel();el.replaceChildren();el.setAttribute('role',failed?'alert':'status');el.setAttribute('aria-live',failed?'assertive':'polite');
  text(el,document.getElementById('clock')?'h2':'h1',failed?'연구실을 시작하지 못했습니다.':'프로그램 파일을 기다리고 있습니다.');
  text(el,'p',failed?'프로그램 파일을 받거나 실행하지 못했습니다. 연결을 확인한 뒤 페이지를 다시 여세요.':`${Math.ceil(timeoutMs/1000)}초 넘게 응답을 기다리고 있습니다. 응답이 오면 자동으로 이어집니다. 연결이 불안정하면 페이지를 다시 여세요.`);
  const button=text(el,'button','페이지 다시 열기');button.id='startup-reload';button.type='button';button.className='primary';
  button.onclick=()=>{if(button.disabled)return;button.disabled=true;button.textContent='페이지를 다시 여는 중…';window.location.reload();};
  text(el,'p','저장된 연구 자료는 삭제하지 않습니다. 계속 열리지 않으면 동봉한 오프라인 HTML로 단독 시연할 수 있습니다.').className='scope';
  if(failed){const details=document.createElement('details');details.id='startup-details';text(details,'summary','시작 오류 상세');text(details,'pre',String(error?.message??error??'알 수 없는 실행 오류'));el.append(details);}
 };
 const stopWatch=()=>{clearTimer(timer);window.removeEventListener('bloodflow:module-started',onStarted);};
 const onStarted=()=>{
  if(phase!=='loading'&&phase!=='waiting')return;
  const wasWaiting=phase==='waiting';phase='application';stopWatch();
  // The app now owns data-loading errors and recovery. Never overwrite that UI with a late watchdog.
  if(wasWaiting){const el=document.getElementById('startup-status');if(el){el.replaceChildren();el.setAttribute('role','status');el.setAttribute('aria-live','polite');text(el,'p','BLOODFLOW 연구 자료를 준비하고 있습니다…');}}
 };
 window.addEventListener('bloodflow:module-started',onStarted);
 timer=setTimer(()=>{if(phase!=='loading')return;phase='waiting';showProblem(false);},timeoutMs);
 // Import only once: repeating a failed module import can reuse a cached rejection or start duplicate clients.
 const completion=Promise.resolve().then(load).then(()=>{phase='ready';stopWatch();return true;},error=>{phase='failed';stopWatch();showProblem(true,error);return false;});
 return {completion};
}
