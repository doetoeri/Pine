const KEY = "pincon-soft-effects-v1";
let theme = "light";
try { theme = JSON.parse(localStorage.getItem(KEY) || "{}").theme === "dark" ? "dark" : "light"; } catch {}
function apply() {
  document.documentElement.dataset.pinconTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101815" : "#f5f7f6");
  const toggle = document.getElementById("pinconThemeToggle");
  toggle?.setAttribute("aria-label", theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
  const icon = toggle?.querySelector("md-icon");
  const text = theme === "dark" ? "light_mode" : "dark_mode";
  if (icon && icon.textContent !== text) icon.textContent = text;
}
document.addEventListener("click", (event) => {
  if (!event.composedPath().some((node) => node.id === "pinconThemeToggle")) return;
  theme = theme === "light" ? "dark" : "light";
  try { localStorage.setItem(KEY, JSON.stringify({ theme })); } catch {}
  apply();
});
window.addEventListener("pincon-render", apply);
apply();
