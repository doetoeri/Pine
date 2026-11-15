import { visionLabSettings } from "../../accessibility/vision-lab-access.js";

const host = document.querySelector("#adminApp");

async function mount() {
  if (!host) return;
  let saved;
  try { ({ public: saved } = await visionLabSettings()); }
  catch { return; }
  if (typeof saved !== "boolean") return;

  const panel = document.createElement("section");
  panel.className = "admin-card admin-card--wide";
  panel.setAttribute("aria-labelledby", "vision-lab-settings-title");
  panel.innerHTML = `<div class="admin-card__header"><h2 id="vision-lab-settings-title">Vision Lab 공개 여부</h2></div>
    <form>
      <label for="vision-lab-visibility">Vision Lab 공개 여부</label>
      <select id="vision-lab-visibility" name="visibility">
        <option value="private">비공개 · 학교 관리자만 열람</option>
        <option value="public">공개 · 누구나 열람</option>
      </select>
      <button type="submit">공개 설정 저장</button>
      <p role="status"></p>
    </form>
    <a href="../../vision-lab/">Vision Lab 열기</a>`;
  const form = panel.querySelector("form");
  const selection = form.elements.visibility;
  const submit = form.querySelector("button");
  const status = form.querySelector('[role="status"]');
  let saving = false;
  selection.value = saved ? "public" : "private";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    submit.setAttribute("aria-disabled", "true");
    status.textContent = "공개 여부를 저장하는 중…";
    try {
      const { public: visibility } = await visionLabSettings(selection.value === "public");
      status.textContent = visibility ? "Vision Lab을 누구나 열 수 있어요." : "학교 관리자만 Vision Lab을 열 수 있어요.";
    } catch (error) {
      status.textContent = [401, 403].includes(error?.status) ? "학교 관리자 로그인 상태를 확인해 주세요." : "저장하지 못했어요. 다시 시도해 주세요.";
    } finally {
      submit.removeAttribute("aria-disabled");
      saving = false;
    }
  });

  function attach() {
    const grid = host.querySelector(".admin-grid");
    if (grid && !panel.isConnected) grid.append(panel);
  }
  const observer = new MutationObserver(attach);
  observer.observe(host, { childList: true, subtree: true });
  attach();
}

mount();
