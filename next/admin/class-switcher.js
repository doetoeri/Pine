import { NextDataGateway, readClassProfile, saveClassProfile } from "../core/data-gateway.js";

const root = document.querySelector("#adminApp");
const gateway = new NextDataGateway();
let mounted = false;

function optionMarkup(selected) {
  const rows = [];
  for (let grade = 1; grade <= 3; grade += 1) {
    for (let classNumber = 1; classNumber <= 10; classNumber += 1) {
      const value = `${grade}-${classNumber}`;
      rows.push(`<md-select-option value="${value}" ${value === selected ? "selected" : ""}><div slot="headline">${grade}학년 ${classNumber}반</div></md-select-option>`);
    }
  }
  return rows.join("");
}

function mount(snapshot) {
  if (mounted || snapshot?.access?.role !== "system-admin") return;
  const actions = root?.querySelector(".admin-topbar__actions");
  if (!actions) return;
  const profile = readClassProfile();
  const current = profile?.classKey || "1-1";
  const wrap = document.createElement("div");
  wrap.className = "admin-class-switcher";
  wrap.innerHTML = `<md-outlined-select id="adminClassSwitch" label="관리 학급" value="${current}">${optionMarkup(current)}</md-outlined-select>`;
  actions.prepend(wrap);
  wrap.querySelector("#adminClassSwitch")?.addEventListener("change", (event) => {
    const [grade, classNumber] = String(event.target.value || "").split("-").map(Number);
    if (!Number.isInteger(grade) || !Number.isInteger(classNumber)) return;
    saveClassProfile(grade, classNumber);
    location.reload();
  });
  mounted = true;
}

await gateway.start();
mount(gateway.snapshot());

new MutationObserver(() => {
  if (mounted && !root?.querySelector("#adminClassSwitch")) mounted = false;
  mount(gateway.snapshot());
}).observe(root, { childList: true, subtree: true });
