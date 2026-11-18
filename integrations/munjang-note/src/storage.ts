import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleWorkspace } from './examples';
import type { Workspace } from './model';

const stores = ['documents', 'annotations', 'categories', 'scopes', 'reviews'] as const;
const STORE_NAMES = [...stores, 'settings'];
type Snapshot = { data: Workspace; revision: number };

class WorkspaceChanged extends Error {}

let opening: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('munjang-note', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of stores) database.createObjectStore(store, { keyPath: 'id' });
        database.createObjectStore('settings');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('다른 탭의 문장노트를 닫은 뒤 다시 열어 주세요.'));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          opening = undefined;
        };
        resolve(database);
      };
    });
    opening.catch(() => { opening = undefined; });
  }
  return opening;
}

async function readSnapshot(): Promise<Snapshot | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAMES, 'readonly');
    const settings = transaction.objectStore('settings');
    const config = settings.get('workspace');
    const documents = transaction.objectStore('documents').getAll();
    const annotations = transaction.objectStore('annotations').getAll();
    const categories = transaction.objectStore('categories').getAll();
    const scopes = transaction.objectStore('scopes').getAll();
    const reviews = transaction.objectStore('reviews').getAll();
    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => {
      if (!config.result) { resolve(null); return; }
      const { revision, display, exportSettings, categoryOrder, scopeOrder } = config.result;
      const order = <T extends { id: string }>(items: T[], ids: string[] = []) => {
        const ranks = new Map(ids.map((id, index) => [id, index]));
        return items.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
      };
      resolve({
        revision,
        data: {
          display, exportSettings, documents: documents.result, annotations: annotations.result,
          categories: order(categories.result, categoryOrder), scopes: order(scopes.result, scopeOrder), reviews: reviews.result,
        },
      });
    };
  });
}

async function writeSnapshot(previous: Snapshot | null, data: Workspace): Promise<Snapshot> {
  const database = await openDatabase();
  const revision = (previous?.revision ?? 0) + 1;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAMES, 'readwrite');
    const settings = transaction.objectStore('settings');
    const config = settings.get('workspace');
    let changed = false;
    let operationError: unknown;
    config.onsuccess = () => {
      if ((config.result?.revision ?? 0) !== (previous?.revision ?? 0)) {
        changed = true;
        transaction.abort();
        return;
      }
      try {
        for (const store of stores) {
          if (previous?.data[store] === data[store]) continue;
          const target = transaction.objectStore(store);
          const old = new Map(previous?.data[store].map((item) => [item.id, item]) ?? []);
          for (const item of data[store]) {
            if (old.get(item.id) !== item) target.put(item);
            old.delete(item.id);
          }
          for (const id of old.keys()) target.delete(id);
        }
        settings.put({ revision, display: data.display, exportSettings: data.exportSettings,
          categoryOrder: data.categories.map((item) => item.id), scopeOrder: data.scopes.map((item) => item.id) }, 'workspace');
      } catch (error) {
        operationError = error;
        transaction.abort();
      }
    };
    transaction.onabort = () => reject(changed ? new WorkspaceChanged('다른 탭에서 데이터가 바뀌었어요. 화면을 확인하고 다시 저장해 주세요.') :
      operationError ?? transaction.error ?? new Error('저장에 실패했어요.'));
    transaction.oncomplete = () => resolve({ revision, data });
  });
}

async function loadWorkspace(): Promise<Snapshot> {
  const active = await readSnapshot();
  if (active) return active;
  try { return await writeSnapshot(null, sampleWorkspace()); }
  catch (error) {
    if (error instanceof WorkspaceChanged) {
      const snapshot = await readSnapshot();
      if (snapshot) return snapshot;
    }
    throw error;
  }
}

export type Commit = (update: (previous: Workspace) => Workspace) => Promise<void>;

export function useWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const active = useRef<Snapshot | undefined>(undefined);
  const channel = useRef<BroadcastChannel | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const accept = useCallback((loaded: Snapshot) => {
    if (active.current && active.current.revision >= loaded.revision) return;
    active.current = loaded;
    setSnapshot(loaded);
    setError('');
  }, []);

  useEffect(() => {
    let mounted = true;
    loadWorkspace().then((value) => { if (mounted) accept(value); }).catch((reason) => {
      if (mounted) setError(reason instanceof Error ? reason.message : '저장 공간을 열 수 없어요.');
    });
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('munjang-note:workspace');
      channel.current.onmessage = () => {
        readSnapshot().then((loaded) => { if (mounted && loaded) accept(loaded); }).catch(() => {});
      };
    }
    return () => { mounted = false; channel.current?.close(); channel.current = null; };
  }, [accept]);

  const commit: Commit = useCallback((update) => {
    const task = queue.current.then(async () => {
      const previous = active.current;
      if (!previous) throw new Error('저장 공간이 준비되지 않았어요.');
      const data = update(previous.data);
      if (previous.data === data) return;
      try {
        const next = await writeSnapshot(previous, data);
        accept(next);
        channel.current?.postMessage(next.revision);
      } catch (error) {
        if (error instanceof WorkspaceChanged) {
          const loaded = await readSnapshot();
          if (loaded) accept(loaded);
        }
        throw error;
      }
    });
    queue.current = task.catch(() => {});
    return task;
  }, [accept]);

  return { data: snapshot?.data, error, commit };
}

export function download(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
