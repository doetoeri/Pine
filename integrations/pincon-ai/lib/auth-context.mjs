import { AsyncLocalStorage } from "node:async_hooks";

const authStorage = new AsyncLocalStorage();

export function runWithAuth(auth, fn) {
  return authStorage.run(auth, fn);
}

export function currentAuth() {
  return authStorage.getStore() || null;
}
