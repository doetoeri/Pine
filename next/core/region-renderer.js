const regions = new WeakMap();
function keyFor(node, index) {
  return node.dataset.renderKey || node.id || `${node.tagName}:${node.className}:${index}`;
}
function remember(container, source = container) {
  const map = new Map();
  const candidates = [...source.children];
  [...container.children].forEach((node, index) => {
    const candidate = candidates[index] || node;
    map.set(keyFor(node, index), { node, markup: candidate.outerHTML });
    if (node.hasAttribute("data-render-group")) remember(node, candidate);
  });
  regions.set(container, map);
}
export function rememberPage(main, markup = "") {
  const page = main.querySelector(":scope > .view-enter, :scope > .qf-page");
  if (!page) return;
  const template = document.createElement("template");
  template.innerHTML = markup;
  remember(page, template.content.querySelector(".view-enter, .qf-page") || page);
}
export function patchRegions(container, source) {
  const previous = regions.get(container) || new Map();
  const next = new Map();
  let anchor = null;
  [...source.children].forEach((candidate, index) => {
    const key = keyFor(candidate, index);
    const markup = candidate.outerHTML;
    const old = previous.get(key);
    let node = old?.node?.isConnected ? old.node : null;
    if (!node) {
      node = candidate;
      if (node.hasAttribute("data-render-group")) remember(node);
      container.insertBefore(node, anchor ? anchor.nextSibling : container.firstChild);
    } else if (old.markup !== markup) {
      if (candidate.hasAttribute("data-render-group")) patchRegions(node, candidate);
      else {
        node.replaceWith(candidate);
        node = candidate;
        if (node.hasAttribute("data-render-group")) remember(node);
      }
    }
    if (anchor && (anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) {
      container.insertBefore(node, anchor.nextSibling);
    }
    anchor = node;
    next.set(key, { node, markup });
  });
  for (const [key, { node }] of previous) if (!next.has(key)) node.remove();
  regions.set(container, next);
}
export function patchPage(main, markup, sameRoute) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  const current = main.querySelector(":scope > .view-enter, :scope > .qf-page");
  const next = template.content.querySelector(".view-enter, .qf-page");
  if (sameRoute && current && next) patchRegions(current, next);
  else {
    // Custom elements reflect accessibility attributes when connected. Keep
    // the source signature before that happens, so the first update is stable.
    if (next) remember(next);
    main.replaceChildren(template.content);
  }
}
