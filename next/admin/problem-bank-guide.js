const PROMPT = `PinCon 문제은행에 새 문제를 추가해줘.

반드시 next/data/problem-bank.schema.json 스키마를 따르고, next/data/problem-bank.json의 기존 problems 배열은 보존해.
대상 학급은 1-8이야.
새 문제의 id는 기존 id와 겹치지 않는 pb-YYYYMMDD-과목영문-번호 형식으로 만들어.
AI가 만든 새 문제는 source.kind를 ai-generated, status를 draft로 설정해.
객관식은 choices 4개를 권장하고 answer는 choices 중 하나와 글자까지 정확히 같아야 해.
주관식은 choices를 빈 배열로 둬.
저작권이 있는 문제집 문장을 그대로 복제하지 말고 새 문항을 작성해.
각 문제에 짧고 검증 가능한 explanation을 넣어.
변경 후 problem-bank contract test가 통과하는지 확인해.`;

let injected = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function copyPrompt(button, status) {
  try {
    await navigator.clipboard.writeText(PROMPT);
    status.textContent = "AI용 프롬프트를 복사했습니다.";
    button.textContent = "복사됨";
    setTimeout(() => { button.textContent = "AI 프롬프트 복사"; }, 1800);
  } catch {
    status.textContent = "클립보드 권한이 없어 복사하지 못했습니다. 아래 프롬프트를 직접 복사해 주세요.";
  }
}

function inject() {
  if (injected) return;
  const grid = document.querySelector("#adminApp .admin-grid");
  if (!grid) return;
  injected = true;

  const card = document.createElement("section");
  card.className = "admin-card admin-card--wide";
  card.dataset.problemBankGuide = "true";
  card.innerHTML = `
    <div class="admin-card__header">
      <h2>문제은행 · AI 추가</h2>
      <span class="admin-meta">JSON SCHEMA</span>
    </div>
    <div class="admin-status" role="status">
      <md-icon>smart_toy</md-icon>
      <p>AI는 <code>next/data/problem-bank.json</code>만 수정하면 됩니다. 새 AI 문제는 초안으로 들어가고, 형식 오류는 CI가 막습니다.</p>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px">
      <md-filled-tonal-button id="copyProblemBankPrompt"><md-icon slot="icon">content_copy</md-icon>AI 프롬프트 복사</md-filled-tonal-button>
      <md-outlined-button id="openProblemBankSchema"><md-icon slot="icon">data_object</md-icon>JSON Schema 보기</md-outlined-button>
    </div>
    <p id="problemBankGuideStatus" class="managed-editor-status" role="status"></p>
    <details style="margin-top:12px">
      <summary>AI에게 전달되는 규칙 보기</summary>
      <pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.6">${escapeHtml(PROMPT)}</pre>
    </details>`;
  grid.appendChild(card);

  const status = card.querySelector("#problemBankGuideStatus");
  card.querySelector("#copyProblemBankPrompt")?.addEventListener("click", (event) => copyPrompt(event.currentTarget, status));
  card.querySelector("#openProblemBankSchema")?.addEventListener("click", () => {
    window.open("../data/problem-bank.schema.json", "_blank", "noopener,noreferrer");
  });
}

const observer = new MutationObserver(inject);
observer.observe(document.documentElement, { childList: true, subtree: true });
inject();
