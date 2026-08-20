const ROOT_MODE = "material-expressive";
const DESIGN_KEY = "pincon-design-system-v1";
const PROXY_ATTR = "data-pincon-material-proxy";
const SOURCE_ATTR = "data-pincon-material-source";
const CARD_ATTR = "data-pincon-material-cardized";

const BUTTON_SELECTOR = [
  "button",
  '[role="button"]',
  "md-filled-button",
  "md-filled-tonal-button",
  "md-outlined-button",
  "md-text-button",
  "md-icon-button",
  "md-fab",
].join(",");

const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="color"])',
  "textarea",
  "select",
].join(",");

function lockExpressiveMode() {
  document.documentElement.dataset.pinconDesign = ROOT_MODE;
  document.body?.classList.add("pincon-expressive", "pincon-material-components-25");
  try { localStorage.setItem(DESIGN_KEY, ROOT_MODE); } catch {}
}

function isProxy(node) {
  return node instanceof Element && (node.hasAttribute(PROXY_ATTR) || node.closest(`[${PROXY_ATTR}]`));
}

function isMaterialSource(node) {
  return node instanceof Element && node.hasAttribute(SOURCE_ATTR);
}

function copyAria(source, target) {
  ["aria-label", "aria-labelledby", "aria-describedby", "aria-expanded", "aria-pressed", "aria-selected", "title"].forEach((name) => {
    const value = source.getAttribute?.(name);
    if (value == null) target.removeAttribute(name);
    else target.setAttribute(name, value);
  });
}

function iconOnly(source) {
  const text = (source.textContent || "").trim();
  const icon = source.querySelector?.("md-icon, svg, img, .material-symbols-rounded, .material-icons");
  const cls = String(source.className || "").toLowerCase();
  return Boolean(icon && (!text || cls.includes("icon") || cls.includes("close") || cls.includes("menu")));
}

function buttonColor(source) {
  if (source.matches?.("md-filled-button")) return "filled";
  if (source.matches?.("md-filled-tonal-button")) return "tonal";
  if (source.matches?.("md-outlined-button")) return "outlined";
  if (source.matches?.("md-text-button, md-icon-button")) return "text";

  const cls = String(source.className || "").toLowerCase();
  const label = `${source.getAttribute?.("aria-label") || ""} ${source.textContent || ""}`.toLowerCase();
  if (/(primary|submit|save|confirm)/.test(cls) || /(저장|추가|완료|확인|등록|보내기)/.test(label)) return "filled";
  if (/(outline|secondary)/.test(cls) || /취소/.test(label)) return "outlined";
  if (/(text|ghost|link)/.test(cls)) return "text";
  return "tonal";
}

function syncButtonContent(source, proxy) {
  const signature = `${source.innerHTML}::${source.getAttribute?.("aria-label") || ""}`;
  if (proxy.__pinconContentSignature === signature) return;
  proxy.__pinconContentSignature = signature;
  proxy.replaceChildren();
  for (const node of source.childNodes) {
    const clone = node.cloneNode(true);
    if (clone instanceof Element) clone.removeAttribute("slot");
    proxy.appendChild(clone);
  }
  if (!proxy.childNodes.length) proxy.textContent = source.getAttribute?.("aria-label") || source.textContent || "";
}

function transferLayout(source, host) {
  const style = getComputedStyle(source);
  const display = style.display;
  host.style.display = display === "block" || display === "flex" || display === "grid" ? "grid" : "inline-grid";
  host.style.verticalAlign = style.verticalAlign;
  host.style.alignSelf = style.alignSelf;
  host.style.justifySelf = style.justifySelf;
  host.style.flexGrow = style.flexGrow;
  host.style.flexShrink = style.flexShrink;
  host.style.flexBasis = style.flexBasis;
  host.style.gridColumn = style.gridColumn;
  host.style.gridRow = style.gridRow;
  host.style.order = style.order;
  host.style.marginTop = style.marginTop;
  host.style.marginRight = style.marginRight;
  host.style.marginBottom = style.marginBottom;
  host.style.marginLeft = style.marginLeft;
  source.style.margin = "0";
}

function hostSource(source, proxy) {
  const parent = source.parentNode;
  if (!parent) return null;
  const host = document.createElement("span");
  host.className = "pincon-material-proxy-host";
  host.setAttribute(PROXY_ATTR, "host");
  transferLayout(source, host);
  parent.insertBefore(host, source);
  host.append(source, proxy);
  source.setAttribute(SOURCE_ATTR, "true");
  if (!source.hasAttribute("data-pincon-original-aria-hidden")) source.setAttribute("data-pincon-original-aria-hidden", source.getAttribute("aria-hidden") || "");
  source.setAttribute("aria-hidden", "true");
  if (!source.hasAttribute("data-pincon-original-tabindex")) source.setAttribute("data-pincon-original-tabindex", source.getAttribute("tabindex") || "");
  source.tabIndex = -1;
  return host;
}

function makeButtonProxy(source) {
  if (!(source instanceof HTMLElement) || isProxy(source) || isMaterialSource(source)) return;
  if (source.closest?.(`[${PROXY_ATTR}]`)) return;
  if (source.matches?.("[hidden], [aria-hidden='true']")) return;

  const isFab = source.matches?.("md-fab") || /(^|\s)(fab|floating-action)(\s|$)/i.test(String(source.className || ""));
  const isIcon = !isFab && iconOnly(source);
  const tag = isFab ? "md-gb-fab" : isIcon ? "md-gb-icon-button" : "md-gb-button";
  if (!customElements.get(tag)) return;

  const proxy = document.createElement(tag);
  proxy.setAttribute(PROXY_ATTR, tag);
  proxy.classList.add("pincon-material-control");
  copyAria(source, proxy);
  syncButtonContent(source, proxy);

  if (tag === "md-gb-button") {
    proxy.color = buttonColor(source);
    proxy.size = source.getBoundingClientRect().height >= 52 ? "md" : "sm";
  } else if (tag === "md-gb-fab") {
    proxy.color = "primary-container";
    proxy.size = source.getBoundingClientRect().height >= 80 ? "large" : "default";
  }

  const disabled = Boolean(source.disabled || source.getAttribute?.("aria-disabled") === "true");
  if ("disabled" in proxy) proxy.disabled = disabled;

  proxy.addEventListener("click", (event) => {
    if (event.defaultPrevented || source.disabled || source.getAttribute?.("aria-disabled") === "true") return;
    event.stopPropagation();
    source.click();
  });

  const host = hostSource(source, proxy);
  if (!host) return;
  source.__pinconMaterialProxy = proxy;
  proxy.__pinconMaterialSource = source;
}

function fieldKind(source) {
  if (source.matches("select")) return "select";
  const type = (source.getAttribute("type") || "text").toLowerCase();
  if (type === "checkbox") return source.getAttribute("role") === "switch" ? "switch" : "checkbox";
  if (type === "radio") return "radio";
  return "text";
}

function labelFor(source) {
  const id = source.id;
  const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return source.getAttribute("aria-label") || explicit?.textContent?.trim() || source.getAttribute("placeholder") || source.getAttribute("name") || "";
}

function syncFieldFromSource(source, proxy, kind) {
  const disabled = Boolean(source.disabled || source.getAttribute("aria-disabled") === "true");
  if ("disabled" in proxy) proxy.disabled = disabled;
  copyAria(source, proxy);

  if (kind === "checkbox" || kind === "radio" || kind === "switch") {
    proxy.checked = Boolean(source.checked);
    if (kind === "radio" && source.name) proxy.name = source.name;
    return;
  }

  if (kind === "select") {
    const signature = Array.from(source.options).map((option) => `${option.value}:${option.textContent}:${option.disabled}:${option.selected}`).join("|");
    if (proxy.__pinconOptionsSignature !== signature) {
      proxy.__pinconOptionsSignature = signature;
      proxy.replaceChildren();
      for (const option of source.options) {
        const item = document.createElement("md-select-option");
        item.value = option.value;
        item.textContent = option.textContent;
        if (option.disabled) item.disabled = true;
        if (option.selected) item.selected = true;
        proxy.appendChild(item);
      }
    }
    proxy.value = source.value;
    proxy.label = labelFor(source);
    return;
  }

  proxy.value = source.value ?? "";
  proxy.label = labelFor(source);
  if (source instanceof HTMLTextAreaElement) {
    proxy.type = "textarea";
    proxy.rows = Math.max(3, source.rows || 3);
  } else {
    const allowed = new Set(["text", "email", "password", "search", "tel", "url", "number", "date", "time"]);
    const type = (source.type || "text").toLowerCase();
    proxy.type = allowed.has(type) ? type : "text";
  }
  if (source.required) proxy.required = true;
}

function writeSourceValue(source, value, checked) {
  if (typeof checked === "boolean") source.checked = checked;
  if (value !== undefined && "value" in source) source.value = value;
}

function dispatchSourceEvent(source, type) {
  if (type === "input") source.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText" }));
  else source.dispatchEvent(new Event("change", { bubbles: true }));
}

function makeFieldProxy(source) {
  if (!(source instanceof HTMLElement) || isProxy(source) || isMaterialSource(source)) return;
  if (source.closest?.(`[${PROXY_ATTR}]`)) return;
  if (source.matches?.("[hidden], [aria-hidden='true']")) return;

  const kind = fieldKind(source);
  const tag = {
    text: "md-outlined-text-field",
    select: "md-outlined-select",
    checkbox: "md-checkbox",
    radio: "md-radio",
    switch: "md-switch",
  }[kind];
  if (!tag || !customElements.get(tag)) return;

  const proxy = document.createElement(tag);
  proxy.setAttribute(PROXY_ATTR, tag);
  proxy.classList.add("pincon-material-field");
  syncFieldFromSource(source, proxy, kind);

  proxy.addEventListener("input", () => {
    if (kind === "checkbox" || kind === "radio" || kind === "switch") writeSourceValue(source, undefined, Boolean(proxy.checked));
    else writeSourceValue(source, proxy.value);
    dispatchSourceEvent(source, "input");
  });
  proxy.addEventListener("change", () => {
    if (kind === "checkbox" || kind === "radio" || kind === "switch") writeSourceValue(source, undefined, Boolean(proxy.checked));
    else writeSourceValue(source, proxy.value);
    dispatchSourceEvent(source, "change");
  });

  const host = hostSource(source, proxy);
  if (!host) return;
  source.__pinconMaterialProxy = proxy;
  proxy.__pinconMaterialSource = source;
}

function cardTone(source) {
  const cls = String(source.className || "").toLowerCase();
  if (/(hero|primary|highlight|urgent)/.test(cls)) return "filled";
  if (/(floating|elevated|popup)/.test(cls)) return "elevated";
  return "outlined";
}

function addCardComponent(source) {
  if (!(source instanceof HTMLElement) || source.hasAttribute(CARD_ATTR) || isProxy(source)) return;
  if (!customElements.get("md-gb-card")) return;
  const cls = String(source.className || "").toLowerCase();
  if (!/(card|panel|tile|widget|content-section|pincon-material-shell)/.test(cls)) return;
  if (source.matches("md-gb-card") || source.closest("md-gb-card")) return;

  const card = document.createElement("md-gb-card");
  card.setAttribute(PROXY_ATTR, "md-gb-card");
  card.className = "pincon-material-card-backdrop";
  card.color = cardTone(source);
  card.setAttribute("aria-hidden", "true");
  source.prepend(card);
  source.setAttribute(CARD_ATTR, "true");
  source.classList.add("pincon-material-card-host");
}

function syncKnownSources(root = document) {
  root.querySelectorAll?.(`[${SOURCE_ATTR}]`).forEach((source) => {
    const proxy = source.__pinconMaterialProxy;
    if (!proxy?.isConnected) return;
    if (source.matches("button, [role='button'], md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button, md-icon-button, md-fab")) {
      copyAria(source, proxy);
      if (proxy.tagName === "MD-GB-BUTTON") {
        proxy.color = buttonColor(source);
        syncButtonContent(source, proxy);
      }
      if ("disabled" in proxy) proxy.disabled = Boolean(source.disabled || source.getAttribute("aria-disabled") === "true");
    } else if (source.matches("input, textarea, select")) {
      syncFieldFromSource(source, proxy, fieldKind(source));
    }
  });
}

function upgradeScope(root = document) {
  lockExpressiveMode();
  root.querySelectorAll?.(BUTTON_SELECTOR).forEach(makeButtonProxy);
  root.querySelectorAll?.(FIELD_SELECTOR).forEach(makeFieldProxy);
  root.querySelectorAll?.('[class*="card" i], [class*="panel" i], [class*="tile" i], [class*="widget" i], .content-section, .pincon-material-shell').forEach(addCardComponent);
}

function observeApp() {
  const root = document.getElementById("root") || document.body;
  if (!root) return;
  let queued = false;
  const flush = () => {
    queued = false;
    upgradeScope(root);
    syncKnownSources(root);
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "aria-disabled", "aria-label", "aria-pressed", "aria-selected", "value", "checked"] });
  window.setInterval(() => {
    if (!document.hidden) syncKnownSources(root);
  }, 1200);
}

async function boot() {
  lockExpressiveMode();
  try { await globalThis.PINCON_MATERIAL_READY; } catch {}
  try { await globalThis.PINCON_EXPRESSIVE_MATERIAL_READY; } catch {}
  upgradeScope(document);
  syncKnownSources(document);
  observeApp();
  window.dispatchEvent(new CustomEvent("pincon-material-component-bridge-ready", {
    detail: {
      standard: globalThis.PINCON_MATERIAL_STATUS || null,
      expressive: globalThis.PINCON_EXPRESSIVE_MATERIAL_STATUS || null,
    },
  }));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
