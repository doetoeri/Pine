const root = document.querySelector("#adminApp");

const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
const nativeInnerHtmlGet = innerHtmlDescriptor?.get;
const nativeInnerHtmlSet = innerHtmlDescriptor?.set;

function sameNode(current, next) {
  return Boolean(current && next && current.isEqualNode(next));
}

function replaceRegion(currentMain, nextMain, selector, { always = false } = {}) {
  const current = currentMain.querySelector(selector);
  const next = nextMain.querySelector(selector);

  if (!current && !next) return;
  if (!current && next) return;
  if (current && !next) {
    current.remove();
    return;
  }
  if (!always && sameNode(current, next)) return;
  current.replaceWith(next);
}

function patchErrorStatus(currentMain, nextMain) {
  const selector = '.admin-status.admin-status--denied[role="alert"]';
  const current = currentMain.querySelector(selector);
  const next = nextMain.querySelector(selector);

  if (current && !next) {
    current.remove();
    return;
  }
  if (current && next) {
    if (!sameNode(current, next)) current.replaceWith(next);
    return;
  }
  if (!current && next) {
    currentMain.querySelector("#adminOverview")?.insertAdjacentElement("afterend", next);
  }
}

function patchDashboardMarkup(markup) {
  const currentMain = root?.querySelector("#adminMain");
  if (!currentMain || typeof markup !== "string" || !markup.includes('id="adminMain"')) return false;

  const template = document.createElement("template");
  template.innerHTML = markup;
  const nextMain = template.content.querySelector("#adminMain");
  if (!nextMain) return false;

  // Keep the management modules mounted. Material form controls inside this grid
  // retain their element identity, focus, select state and event listeners while
  // the live overview around them is refreshed.
  const moduleGrid = currentMain.querySelector("#adminModuleGrid");
  if (!moduleGrid) return false;

  currentMain.className = nextMain.className;
  currentMain.tabIndex = nextMain.tabIndex;

  replaceRegion(currentMain, nextMain, ".admin-sidebar");
  replaceRegion(currentMain, nextMain, ".admin-topbar", { always: true });
  replaceRegion(currentMain, nextMain, "#adminOverview");
  patchErrorStatus(currentMain, nextMain);
  replaceRegion(currentMain, nextMain, ".admin-metrics");
  replaceRegion(currentMain, nextMain, ".admin-command-layout");
  replaceRegion(currentMain, nextMain, "#adminOperationsInbox");
  replaceRegion(currentMain, nextMain, "#adminAuditExplorer", { always: true });
  replaceRegion(currentMain, nextMain, "#adminSystemHealth");
  replaceRegion(currentMain, nextMain, "#adminSearchDialog", { always: true });

  return true;
}

if (root && nativeInnerHtmlGet && nativeInnerHtmlSet) {
  Object.defineProperty(root, "innerHTML", {
    configurable: true,
    enumerable: true,
    get() {
      return nativeInnerHtmlGet.call(root);
    },
    set(value) {
      if (patchDashboardMarkup(value)) return;
      nativeInnerHtmlSet.call(root, value);
    },
  });
}
