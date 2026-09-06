const ELIGIBLE=new Set(["CLASS_PRESIDENT","CLASS_VICE_PRESIDENT","DEPARTMENT_HEAD","TEACHER","ADMIN"]);
const account=globalThis.PINCON_ACCOUNT?.account||null;
const roles=new Set(Array.isArray(account?.roles)?account.roles:[]);
const eligible=[...roles].some((r)=>ELIGIBLE.has(r));

function style(){if(document.querySelector("#pinconClassroomEntryStyle"))return;const s=document.createElement("style");s.id="pinconClassroomEntryStyle";s.textContent=`.pincon-classroom-entry{position:fixed;right:18px;bottom:max(84px,calc(env(safe-area-inset-bottom) + 72px));z-index:80;display:flex;align-items:center;gap:9px;padding:12px 15px;border-radius:18px;background:var(--md-sys-color-primary,#365b45);color:var(--md-sys-color-on-primary,#fff);text-decoration:none;font-size:13px;font-weight:800;box-shadow:0 10px 28px rgba(28,53,36,.22)}.pincon-classroom-entry md-icon{font-size:20px}@media(max-width:700px){.pincon-classroom-entry{right:12px;bottom:max(76px,calc(env(safe-area-inset-bottom) + 68px));padding:11px 13px}}`;document.head.appendChild(s);}
function roleLabels(){document.querySelectorAll(".pincon-account-center__role").forEach((node)=>{if(node.textContent?.includes("CLASS_VICE_PRESIDENT"))node.innerHTML="<md-icon>record_voice_over</md-icon>학급 부회장";});}
function mount(){roleLabels();if(!eligible)return;if(document.querySelector("#pinconClassroomEntry"))return;style();const a=document.createElement("a");a.id="pinconClassroomEntry";a.className="pincon-classroom-entry";a.href="./classroom/";a.setAttribute("aria-label","교실 배치 열기");a.innerHTML="<md-icon>table_restaurant</md-icon><span>교실 배치</span>";document.body.appendChild(a);}
new MutationObserver(()=>requestAnimationFrame(mount)).observe(document.documentElement,{childList:true,subtree:true});
mount();
