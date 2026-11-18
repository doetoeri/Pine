import type { Annotation, Range } from './model';

export type Part = Range & { notes: Annotation[] };
export function markedParts(text: string, notes: Annotation[], extra: Iterable<number> = []): Part[] {
  const changes = new Map<number, { additions: Annotation[]; removals: Annotation[] }>();
  const at = (offset: number) => {
    const recorded = changes.get(offset);
    if (recorded) return recorded;
    const change = { additions: [], removals: [] };
    changes.set(offset, change);
    return change;
  };
  at(0);
  at(text.length);
  for (const offset of extra) at(offset);
  const byId = new Map(notes.map((note, index) => [note.id, index]));
  for (const note of notes) for (const anchor of note.anchors) {
    if (!anchor.attached || text.slice(anchor.start, anchor.end) !== anchor.quote) continue;
    at(anchor.start).additions.push(note);
    at(anchor.end).removals.push(note);
  }
  const points = Array.from(changes).sort(([a], [b]) => a - b);
  const active = new Map<Annotation, number>();
  const parts: Part[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [start, { additions, removals }] = points[index];
    for (const note of removals) {
      const left = (active.get(note) ?? 1) - 1;
      if (left > 0) active.set(note, left);
      else active.delete(note);
    }
    for (const note of additions) active.set(note, (active.get(note) ?? 0) + 1);
    parts.push({ start, end: points[index + 1][0], notes: [...active.keys()].sort((a, b) => (byId.get(a.id) ?? 0) - (byId.get(b.id) ?? 0)) });
  }
  return parts;
}

export function readSelection(root: HTMLElement, source: string, selection: Selection | null): Range | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = sourceOffset(root, range.startContainer, range.startOffset);
  const quote = range.toString();
  const end = start + quote.length;
  return quote.trim() && source.slice(start, end) === quote ? { start, end } : null;
}

function sourceOffset(root: HTMLElement, node: Node, index: number): number {
  const prefix = root.ownerDocument.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(node, index);
  return prefix.toString().length;
}

export function offsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument;
  const caret = doc.caretPositionFromPoint?.(x, y);
  if (caret && root.contains(caret.offsetNode)) return sourceOffset(root, caret.offsetNode, caret.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  return range && root.contains(range.startContainer) ? sourceOffset(root, range.startContainer, range.startOffset) : null;
}

export function sourceRangeBetween(source: string, a: number, b: number): Range | null {
  const start = Math.min(a, b);
  const text = source.slice(start, Math.max(a, b));
  const quote = text.trim();
  if (!quote) return null;
  const first = start + text.length - text.trimStart().length;
  return { start: first, end: first + quote.length };
}

export function showSourceRange(root: HTMLElement, selected: Range | null): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  if (!selection || !selected) return;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let base = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = base + (node.textContent?.length ?? 0);
    if (!started && selected.start >= base && selected.start <= end) {
      range.setStart(node, selected.start - base);
      started = true;
    }
    if (started && selected.end >= base && selected.end <= end) {
      range.setEnd(node, selected.end - base);
      selection.addRange(range);
      return;
    }
    base = end;
  }
}

export function textareaRange(source: string, start: number, end: number): Range {
  const carriage = /\r\n/g;
  for (const match of source.matchAll(carriage)) {
    if (match.index < start) start += 1;
    if (match.index < end) end += 1;
    else break;
  }
  return { start, end };
}
