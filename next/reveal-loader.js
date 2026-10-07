const boot = document.querySelector("#pinconBoot");
let timer;
function finish() {
  clearTimeout(timer);
  document.body.classList.add("pincon-boot-done");
  boot?.parentNode?.removeChild(boot);
}
if (boot) {
  boot.innerHTML = '<img src="./assets/pincon-icon.svg" alt="" width="48" height="48"><span>PinCon을 여는 중…</span>';
  globalThis.PinConRevealLoader = Object.freeze({ finish });
  boot.remove = finish;
  window.addEventListener("pincon-render", finish, { once: true });
  timer = setTimeout(finish, 2500);
}
