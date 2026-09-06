const ROLE="CLASS_VICE_PRESIDENT";
function mount(){document.querySelectorAll("md-dialog").forEach((dialog)=>{if(dialog.querySelector(`[data-role-check="${ROLE}"]`))return;const first=dialog.querySelector("[data-role-check]")?.closest("label");const host=first?.parentElement;if(!host)return;const label=document.createElement("label");label.className=first.className||"pincon-account-role-card";label.dataset.role=ROLE;label.dataset.selected="false";label.innerHTML=`<md-checkbox data-role-check="${ROLE}"></md-checkbox><span><strong>학급 부회장</strong><small>교실 배치 열람·제보 권한</small></span>`;host.appendChild(label);});}
new MutationObserver(()=>requestAnimationFrame(mount)).observe(document.documentElement,{childList:true,subtree:true});
mount();
