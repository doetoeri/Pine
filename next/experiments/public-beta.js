let pending = false;

function host(event, selector) {
  return event.composedPath?.().find((node) => node instanceof Element && node.matches?.(selector)) || null;
}

document.addEventListener("click", async (event) => {
  const button = host(event, "[data-pincon-public-beta]");
  if (!button || pending) return;
  const action = String(button.getAttribute("data-pincon-public-beta") || "");
  if (!["join", "leave"].includes(action)) return;
  if (action === "join" && !confirm("새 PinCon 공개 베타를 사용해볼까요? 공개 베타 데이터는 정식 A/B 결과와 분리됩니다.")) return;

  pending = true;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = action === "join" ? "참여 처리 중…" : "기존 화면으로 돌아가는 중…";
  try {
    await globalThis.PinConExperiment?.setPublicBetaEnrollment(action === "join");
    location.reload();
  } catch (error) {
    console.error("[PinCon Public Beta]", error);
    alert(error?.message || "공개 베타 상태를 변경하지 못했습니다.");
    button.disabled = false;
    button.textContent = previous;
    pending = false;
  }
}, true);
