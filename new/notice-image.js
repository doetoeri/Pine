import { noticeDay, noticeModel } from "./notice-data.js?v=20261013-notice1";
import { NOTICE_SIZE, noticeLayout, drawNotice } from "./notice-renderer.js?v=20261013-notice1";
import { prepareDialog, openDialog, closeDialog } from "../next/assessments/dialog-motion.js?v=20261009-paper1";

const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const blobOf = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지 저장에 실패했어요. 다시 만들어 주세요.")), "image/png"));

export function mountNoticeImage(gateway) {
  const dialog = document.getElementById("notice-image"), trigger = document.getElementById("notice-open");
  const $ = id => dialog.querySelector(`#${id}`);
  let revision = 0, timer, artifacts = [], page = 0, model, signature = "", classKey = "", selected = null, busy = false;
  prepareDialog(dialog);
  function release() { artifacts.forEach(item => URL.revokeObjectURL(item.url)); artifacts = []; }
  function buttons() {
    const allowed = !busy && artifacts.length && !model?.pending && (!model?.cached || $("notice-cache-ok").checked);
    $("notice-save").disabled = !allowed;
    $("notice-share").disabled = !allowed;
    $("notice-copy").disabled = !allowed;
  }
  const options = () => ({ day: $("notice-day").value, horizon: $("notice-horizon").value,
    includeUndated: $("notice-undated").checked, includeMaterials: $("notice-materials").checked, message: $("notice-message").value, selectedIds: selected });
  function showPage() {
    const artifact = artifacts[page];
    $("notice-preview").hidden = !artifact;
    if (artifact) { $("notice-preview").src = artifact.url; $("notice-preview").alt = `${model.classLabel} 수행 공지 ${page + 1}/${artifacts.length}`; }
    $("notice-page-label").textContent = artifacts.length ? `${page + 1} / ${artifacts.length}장` : "";
    $("notice-prev").disabled = page <= 0;
    $("notice-next").disabled = page >= artifacts.length - 1;
    $("notice-pages").hidden = artifacts.length < 2;
    buttons();
  }
  function list() {
    const candidates = noticeModel(gateway.snapshot(), { ...options(), selectedIds: null }).candidates;
    const checked = selected == null ? new Set(candidates.map(row => row.id)) : new Set(selected);
    $("notice-list").innerHTML = candidates.map(row => `<label class="notice-choice"><input type="checkbox" data-notice-id="${escape(row.id)}"${checked.has(row.id) ? " checked" : ""}><span><strong>${escape(row.subject)} · ${escape(row.title)}</strong><small>${escape(row.dateLabel)} · ${row.verified ? "공식 자료 확인" : "확인 중"}</small></span></label>`).join("") || '<p class="muted">이 기간에 등록된 수행이 없어요.</p>';
    $("notice-selection").textContent = `${candidates.filter(row => checked.has(row.id)).length} / ${candidates.length}개 선택`;
  }
  function schedule({ reset = false, relist = false } = {}) {
    ++revision; clearTimeout(timer); busy = true; buttons();
    if (reset) selected = null;
    if (relist || reset) list();
    $("notice-status").textContent = "이미지를 만들고 있어요…";
    timer = setTimeout(generate, 120);
  }
  async function generate() {
    const version = revision;
    try {
      const snapshot = gateway.snapshot();
      const nextModel = noticeModel(snapshot, options());
      model = nextModel;
      $("notice-cache-warning").hidden = !model.cached;
      $("notice-source").textContent = model.pending ? "수행 자료 연결을 기다리는 중이에요." : `${model.classLabel} · ${model.emptyText}${model.cached ? " · 저장된 자료 기준" : ""}`;
      if (model.pending) { release(); showPage(); $("notice-status").textContent = "자료가 연결되면 자동으로 만들어요. 설정에서 자료를 다시 연결할 수 있어요."; return; }
      // Await both Latin and Hangul faces before measuring or drawing.
      await Promise.allSettled([400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 38px "PinCon OpenAI Sans"`, "PinCon 수행 공지 내일")));
      if (version !== revision || !dialog.open) return;
      const measure = document.createElement("canvas").getContext("2d");
      const pages = noticeLayout(measure, nextModel), nextArtifacts = [];
      try {
        for (const [index, layout] of pages.entries()) {
          const canvas = document.createElement("canvas"); Object.assign(canvas, NOTICE_SIZE);
          drawNotice(canvas.getContext("2d"), nextModel, layout, index, pages.length);
          const blob = await blobOf(canvas);
          nextArtifacts.push({ blob, url: URL.createObjectURL(blob), name: `${nextModel.filename}_${String(index + 1).padStart(2, "0")}.png` });
        }
      } catch (error) { nextArtifacts.forEach(item => URL.revokeObjectURL(item.url)); throw error; }
      if (version !== revision || !dialog.open) { nextArtifacts.forEach(item => URL.revokeObjectURL(item.url)); return; }
      release(); artifacts = nextArtifacts; page = Math.min(page, artifacts.length - 1); showPage();
      $("notice-status").textContent = `${artifacts.length}장 준비됐어요. 저장은 현재 장, 공유는 전체 장을 보내요.`;
    } catch (error) {
      if (version !== revision) return;
      release(); showPage(); $("notice-status").textContent = error.message || "이미지를 만들지 못했어요. 다시 만들어 주세요.";
    } finally { if (version === revision) { busy = false; buttons(); } }
  }
  function open() {
    window.PINCON_STARTUP?.dismiss?.();
    $("notice-day").value = noticeDay(); selected = null; page = 0; classKey = gateway.snapshot().profile?.classKey;
    $("notice-cache-ok").checked = false; signature = "";
    openDialog(dialog); schedule({ relist: true });
  }
  trigger.addEventListener("click", open);
  dialog.addEventListener("close", () => { ++revision; clearTimeout(timer); release(); $("notice-preview").removeAttribute("src"); trigger.focus({ preventScroll: true }); });
  $("notice-close").onclick = () => closeDialog(dialog);
  for (const id of ["notice-day", "notice-horizon", "notice-undated"]) $(id).addEventListener("change", () => schedule({ reset: true }));
  $("notice-materials").onchange = () => schedule();
  $("notice-message").oninput = () => schedule();
  $("notice-cache-ok").onchange = buttons;
  $("notice-list").onchange = () => {
    selected = [...$("notice-list").querySelectorAll("input:checked")].map(input => input.dataset.noticeId);
    $("notice-selection").textContent = `${selected.length} / ${$("notice-list").querySelectorAll("input").length}개 선택`;
    schedule();
  };
  $("notice-all").onclick = () => schedule({ reset: true });
  $("notice-none").onclick = () => { selected = []; schedule({ relist: true }); };
  $("notice-prev").onclick = () => { page--; showPage(); };
  $("notice-next").onclick = () => { page++; showPage(); };
  $("notice-save").onclick = () => {
    if ($("notice-save").disabled) return;
    const item = artifacts[page], link = document.createElement("a");
    link.href = item.url; link.download = item.name; document.body.append(link); link.click(); link.remove();
    $("notice-status").textContent = `${page + 1}번째 PNG 저장을 시작했어요.${artifacts.length > 1 ? " 다음 장도 저장해 주세요." : " 카톡에서 사진으로 첨부해 주세요."}`;
  };
  $("notice-share").onclick = async () => {
    if ($("notice-share").disabled) return;
    // Prepared files keep the native share call inside the user's click gesture.
    const files = artifacts.map(item => new File([item.blob], item.name, { type: "image/png" }));
    if (!navigator.canShare?.({ files }) || !navigator.share) {
      $("notice-status").textContent = "이 브라우저에서는 이미지 공유를 지원하지 않아요. PNG를 저장한 뒤 카톡에 첨부해 주세요."; return;
    }
    try { await navigator.share({ files, title: `${model.classLabel} 수행 공지` }); $("notice-status").textContent = "공유 창에 이미지를 전달했어요."; }
    catch (error) { if (error.name !== "AbortError") $("notice-status").textContent = "공유하지 못했어요. PNG 저장을 이용해 주세요."; }
  };
  $("notice-copy").onclick = async () => {
    if ($("notice-copy").disabled) return;
    const value = [`${model.classLabel} 수행 공지 · ${model.day}`, model.message,
      ...model.rows.map(row => `${row.dateLabel} | ${row.subject} · ${row.title}${model.includeMaterials && row.materials ? `\n준비물: ${row.materials}` : ""}${row.verified ? "" : " (확인 중)"}`),
      model.rows.length ? "" : "선택한 수행 없음", model.cached ? "저장된 자료 기준 · 최신 일정 재확인" : "", "https://pincon.app/new/"].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(value); $("notice-status").textContent = "카톡에 붙여 넣을 공지 문구를 복사했어요."; }
    catch { $("notice-status").textContent = "문구를 복사하지 못했어요. 이미지 저장을 이용해 주세요."; }
  };
  gateway.addEventListener("change", () => {
    if (!dialog.open) return;
    const snapshot = gateway.snapshot();
    const current = JSON.stringify([snapshot.profile?.classKey, snapshot.ready, snapshot.usingCache, snapshot.error, snapshot.online, snapshot.data?.classAssignments]);
    if (current === signature) return;
    signature = current;
    const changedClass = classKey !== snapshot.profile?.classKey; classKey = snapshot.profile?.classKey;
    $("notice-cache-ok").checked = false;
    schedule({ reset: changedClass, relist: true });
  });
  if (location.hash === "#notice") open();
}
