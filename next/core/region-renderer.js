const regions = new WeakMap();
function keyFor(node, index) {
  return node.dataset.renderKey || node.id || `${node.tagName}:${node.className}:${index}`;
}
function remember(container) {
  const map = new Map();
  [...container.children].forEach((node, index) => {
    map.set(keyFor(node, index), { node, markup: node.outerHTML });
    if (node.hasAttribute("data-render-group")) remember(node);
  });
  regions.set(container, map);
}
export function rememberPage(main) {
  const page = main.querySelector(":scope > .view-enter, :scope > .qf-page");
  if (page) remember(page);
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
    main.replaceChildren(template.content);
    rememberPage(main);
  }
}
