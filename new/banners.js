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
  style.textContent = `#pinconBanners{max-width:1100px;margin:16px auto;padding:0 16px}.pc-banner{background:linear-gradient(120deg,#e4ecff,#f4f8f5);border:1px solid #dce4eb;border-radius:22px;padding:22px;margin:12px 0;color:#24344b}.pc-banner h2{margin:0 0 8px;font-size:20px}.pc-banner p{margin:0 0 15px;line-height:1.5}.pc-banner a,.pc-banner button{display:inline-block;border:0;border-radius:12px;padding:10px 16px;background:#253e65;color:white;text-decoration:none;font:inherit;cursor:pointer}.pc-banner-admin{padding:12px 0}.pc-banner-admin form{display:grid;gap:8px;max-width:520px}.pc-banner-admin input{font:inherit;padding:10px;border:1px solid #bdc9d2;border-radius:10px}.pc-banner-admin button{margin-right:8px}.pc-banner-admin small{display:block;margin-top:8px}`;
  document.head.append(style);
  const host = document.createElement("section");
  host.id = "pinconBanners";
  host.setAttribute("aria-label","PinCon 안내 배너");
  const anchor = document.querySelector("#covers") || document.querySelector("main");
  if (anchor?.parentNode) anchor.parentNode.insertBefore(host, anchor);
  else document.body.prepend(host);
  let busy = false;
  const render = () => {
    const snap = gateway.snapshot();
    const banners = (snap.data?.announcements || []).map(decode).filter(Boolean);
    const admin = (snap.access?.role === "system-admin" || snap.access?.role === "manager") && snap.canArchiveContent === true;
    host.innerHTML = banners.map(b => `<article class="pc-banner"><h2>${escapeHtml(b.title)}</h2><p>${escapeHtml(b.description)}</p><a href="${escapeHtml(b.href)}">${escapeHtml(b.label)}</a>${admin ? ` <button type="button" data-remove-banner="${escapeHtml(b.id)}">배너 삭제</button>` : ""}</article>`).join("") + (admin ? `<details class="pc-banner-admin"><summary>배너 관리 · 추가</summary><form id="pinconBannerForm"><input name="title" maxlength="100" placeholder="배너 제목" required><input name="description" maxlength="180" placeholder="설명"><input name="label" maxlength="24" placeholder="버튼 문구" value="바로가기"><input name="href" placeholder="/experiments/" required><button type="submit">배너 등록</button><small>PinCon 내부 경로만 허용합니다. 등록 즉시 전체 학생 화면에 표시됩니다.</small></form></details>` : "");
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
