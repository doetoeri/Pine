const PREFIX = "[PINCON_BANNER]";
const routes = ["/new/", "/experiments/", "/bloodflow/", "/next/", "/next/admin/", "/research/"];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function safePath(raw) {
  try {
    const url = new URL(String(raw || ""), location.origin);
    if (url.origin !== location.origin || !routes.some(p => url.pathname === p || url.pathname.startsWith(p))) return "";
    return url.pathname + url.search + url.hash;
  } catch { return ""; }
}
function decode(row) {
  if (row.deleted || !String(row.body || "").startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(row.body.slice(PREFIX.length));
    const href = safePath(data.href);
    if (!href || !row.title) return null;
    return { id: row.id, title: row.title, description: String(data.description || "").slice(0,180), label: String(data.label || "바로가기").slice(0,24), href };
  } catch { return null; }
}
export function mountBanners(gateway) {
  const style = document.createElement("style");
  style.textContent = `#pinconBanners{width:min(100% - 24px,1160px);margin:10px auto;color:#24344b;font-family:inherit}.pc-banner-shell{border:1px solid #dce5ed;border-radius:16px;background:linear-gradient(110deg,#f2f6ff,#f7fafb);box-shadow:0 3px 14px #233c5910;overflow:hidden}.pc-banner-top{display:flex;align-items:center;gap:10px;padding:8px 12px;min-height:40px}.pc-banner-tag{font-size:11px;font-weight:800;color:#41618d;background:#e3edff;border-radius:7px;padding:4px 7px;white-space:nowrap}.pc-banner-top strong{font-size:13px;flex:1}.pc-banner-toggle,.pc-banner-admin summary{cursor:pointer;border:0;background:transparent;color:#53677d;font:inherit;font-size:12px;font-weight:650}.pc-banner-list[hidden]{display:none}.pc-banner-list{padding:0 10px 9px;display:grid;gap:6px}.pc-banner{display:flex;align-items:center;gap:12px;min-height:52px;padding:9px 12px;border:1px solid #e3e9f0;border-radius:11px;background:#fff}.pc-banner-copy{min-width:0;flex:1}.pc-banner h2{margin:0 0 2px;font-size:14px;font-weight:750;line-height:1.35}.pc-banner p{margin:0;font-size:12px;line-height:1.4;color:#687789;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pc-banner-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}.pc-banner a{display:inline-flex;align-items:center;justify-content:center;background:#2e4f7e;color:#fff;text-decoration:none;border-radius:9px;padding:8px 11px;font-size:12px;font-weight:700;white-space:nowrap}.pc-banner-remove{background:#fff;border:1px solid #dce3ea;border-radius:8px;color:#8b4a4a;padding:7px 9px;cursor:pointer;font:inherit;font-size:11px}.pc-banner-admin{margin-top:8px;border:1px solid #e0e7ef;border-radius:14px;background:#fff;overflow:hidden}.pc-banner-admin summary{list-style:none;padding:11px 13px;display:flex;align-items:center;justify-content:space-between}.pc-banner-admin summary::-webkit-details-marker{display:none}.pc-banner-admin summary:after{content:'⌄';font-size:16px}.pc-banner-admin[open] summary:after{content:'⌃'}.pc-banner-admin form{padding:0 13px 13px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.pc-banner-admin label{font-size:11px;color:#64758a;font-weight:650;display:grid;gap:5px}.pc-banner-admin input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:10px;border:1px solid #d9e2eb;border-radius:9px;background:#fbfcfe}.pc-banner-admin button{border:0;border-radius:9px;background:#2e4f7e;color:white;padding:10px 14px;font:inherit;font-size:12px;font-weight:700;cursor:pointer}.pc-banner-admin small{align-self:center;font-size:11px;color:#718095}.pc-banner-admin .pc-wide{grid-column:1/-1}@media(max-width:560px){.pc-banner{gap:8px;padding:9px}.pc-banner h2{font-size:13px}.pc-banner p{font-size:11px}.pc-banner a{padding:8px}.pc-banner-admin form{grid-template-columns:1fr}.pc-banner-admin .pc-wide{grid-column:auto}}`;
  document.head.append(style);
  const host = document.createElement("section");
  host.id = "pinconBanners";
  host.setAttribute("aria-label","PinCon 안내 배너");
  const anchor = document.querySelector("#covers") || document.querySelector("main");
  if (anchor?.parentNode) anchor.parentNode.insertBefore(host, anchor);
  else document.body.prepend(host);
  let busy = false;
  let collapsed = false;
  let adminOpen = false;
  const render = () => {
    const snap = gateway.snapshot();
    const banners = (snap.data?.announcements || []).map(decode).filter(Boolean);
    const admin = (snap.access?.role === "system-admin" || snap.access?.role === "manager") && snap.canArchiveContent === true;
    const wasOpen = host.querySelector(".pc-banner-admin")?.open;
    if (wasOpen !== undefined) adminOpen = wasOpen;
    const list = banners.map(b => `<article class="pc-banner"><div class="pc-banner-copy"><h2>${escapeHtml(b.title)}</h2>${b.description ? `<p>${escapeHtml(b.description)}</p>` : ""}</div><div class="pc-banner-actions"><a href="${escapeHtml(b.href)}">${escapeHtml(b.label)} ↗</a>${admin ? `<button class="pc-banner-remove" type="button" data-remove-banner="${escapeHtml(b.id)}" aria-label="${escapeHtml(b.title)} 배너 삭제">삭제</button>` : ""}</div></article>`).join("");
    const bannerUI = banners.length ? `<div class="pc-banner-shell"><div class="pc-banner-top"><span class="pc-banner-tag">PINCON</span><strong>새 소식 <span aria-label="배너 수">${banners.length}</span></strong><button class="pc-banner-toggle" type="button" data-toggle-banners aria-expanded="${!collapsed}">${collapsed ? "펼치기 ＋" : "접기 −"}</button></div><div class="pc-banner-list" ${collapsed ? "hidden" : ""}>${list}</div></div>` : "";
    const editor = admin ? `<details class="pc-banner-admin" ${adminOpen ? "open" : ""}><summary>배너 관리 · 새 배너 추가</summary><form id="pinconBannerForm"><label>제목<input name="title" maxlength="100" placeholder="예: 실험 참가 안내" required></label><label>버튼 문구<input name="label" maxlength="24" placeholder="바로가기" value="바로가기"></label><label class="pc-wide">설명<input name="description" maxlength="180" placeholder="한 줄로 간결하게 안내하세요"></label><label class="pc-wide">연결 주소<input name="href" placeholder="/experiments/" required></label><button type="submit">배너 등록</button><small>PinCon 내부 주소만 허용됩니다.</small></form></details>` : "";
    host.innerHTML = bannerUI + editor;
  };
  host.addEventListener("submit", async event => {
    if (event.target.id !== "pinconBannerForm" || busy) return;
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form));
    const href = safePath(values.href);
    if (!href) { alert("허용된 PinCon 내부 주소를 입력하세요."); return; }
    busy = true;
    try {
      await gateway.saveManagedRecord("announcements", {title:values.title,priority:"normal",body:PREFIX+JSON.stringify({description:values.description,label:values.label,href})});
      form.reset();
      await gateway.retry();
    } catch(e) { alert(e.message || "배너를 저장하지 못했습니다."); }
    finally { busy = false; render(); }
  });
  host.addEventListener("click", async event => {
    if (event.target.closest("[data-toggle-banners]")) { collapsed = !collapsed; render(); return; }
    const id = event.target.closest("[data-remove-banner]")?.dataset.removeBanner;
    if (!id || busy || !confirm("이 배너를 삭제할까요?")) return;
    busy = true;
    try { await gateway.archiveManagedRecord("announcements",id); await gateway.retry(); }
    catch(e) { alert(e.message || "배너 삭제 실패"); }
    finally { busy=false; render(); }
  });
  gateway.addEventListener("change",render);
  render();
}
