(() => {
  const SDK = '12.16.0';
  const CONFIG = globalThis.PINCON_FIREBASE_CONFIG || {};
  const INDEX_KEY = 'pincon-hanja-index';
  const MASTERY_KEY = 'pincon-hanja-mastery';
  const META_KEY = 'pincon-hanja-sync-meta-v1';
  const DEVICE_KEY = 'pincon-hanja-device-id-v1';
  const DEVICE_COUNT_KEY = 'pincon-hanja-device-count-v1';
  const WATCHED = new Set([INDEX_KEY, MASTERY_KEY]);

  let api = null;
  let auth = null;
  let db = null;
  let user = null;
  let syncReady = false;
  let suppressStorage = false;
  let flushTimer = 0;
  let heartbeatTimer = 0;
  let lastLocalInteractionAt = 0;
  let pendingState = false;
  const pendingProgress = new Set();
  const unsubscribers = [];

  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;

  const deviceId = (() => {
    let existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    existing = globalThis.crypto?.randomUUID?.() || `hanja-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    nativeSetItem.call(localStorage, DEVICE_KEY, existing);
    return existing;
  })();

  const meta = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      return {
        indexUpdatedAtMs: Number(parsed.indexUpdatedAtMs || 0),
        progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
      };
    } catch (_) {
      return { indexUpdatedAtMs: 0, progress: {} };
    }
  })();

  function saveMeta() {
    nativeSetItem.call(localStorage, META_KEY, JSON.stringify(meta));
  }

  function safeMastery() {
    try { return JSON.parse(localStorage.getItem(MASTERY_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function safeIndex() {
    const value = Number(localStorage.getItem(INDEX_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function currentCharFromIndex(value = safeIndex()) {
    try {
      if (typeof hanjaSet === 'undefined' || !Array.isArray(hanjaSet) || !hanjaSet.length) return '';
      const normalized = ((value % hanjaSet.length) + hanjaSet.length) % hanjaSet.length;
      return hanjaSet[normalized]?.char || '';
    } catch (_) {
      return '';
    }
  }

  function indexForChar(char, fallback = 0) {
    try {
      if (typeof hanjaSet === 'undefined' || !Array.isArray(hanjaSet)) return fallback;
      const found = hanjaSet.findIndex(item => item.char === char);
      return found >= 0 ? found : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function validGrade(value) {
    return value === 'again' || value === 'hard' || value === 'good';
  }

  function parseJson(value) {
    try { return JSON.parse(value || '{}') || {}; }
    catch (_) { return {}; }
  }

  function deviceLabel() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPad/i.test(ua) || touchMac) return 'iPad';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua) && Math.min(screen.width || 0, screen.height || 0) >= 600) return 'Android 태블릿';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    return '웹 기기';
  }

  function deviceType() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPad/i.test(ua) || touchMac) return 'tablet';
    if (/Android/i.test(ua) && Math.min(screen.width || 0, screen.height || 0) >= 600) return 'tablet';
    if (/iPhone|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function installUi() {
    if (document.getElementById('hanjaSyncBar')) return;
    const anchor = document.getElementById('hanjaRosterMain') || document.querySelector('.study-meta');
    if (!anchor) return;
    const bar = document.createElement('section');
    bar.id = 'hanjaSyncBar';
    bar.className = 'hanja-sync-bar';
    bar.dataset.state = navigator.onLine ? 'syncing' : 'offline';
    bar.innerHTML = `
      <div class="hanja-sync-copy">
        <span class="hanja-sync-dot" aria-hidden="true"></span>
        <div class="hanja-sync-text">
          <strong>모든 기기 연동</strong>
          <span id="hanjaSyncMessage">${navigator.onLine ? '계정과 동기화 상태를 확인하는 중…' : '오프라인 · 이 기기에 안전하게 저장 중'}</span>
        </div>
      </div>
      <div class="hanja-sync-actions">
        <span class="hanja-sync-device-count" id="hanjaSyncDevices">연동 기기 확인 중</span>
        <button class="hanja-sync-button" id="hanjaSyncButton" type="button">Google로 연동</button>
      </div>`;
    anchor.insertAdjacentElement('afterend', bar);

    bar.addEventListener('pointermove', event => {
      const rect = bar.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      bar.style.setProperty('--lg-x', `${((event.clientX - rect.left) / rect.width * 100).toFixed(1)}%`);
      bar.style.setProperty('--lg-y', `${((event.clientY - rect.top) / rect.height * 100).toFixed(1)}%`);
    }, { passive: true });

    document.getElementById('hanjaSyncButton')?.addEventListener('click', async () => {
      if (user && !user.isAnonymous) {
        setSyncState('syncing', '지금 모든 기기의 학습 상태를 다시 맞추는 중…');
        await flushAll(true);
        setSyncState('synced', '동기화 완료 · 이 기기의 변경 사항이 다른 기기에도 반영됩니다.');
      } else {
        await signInWithGoogle();
      }
    });

    const cachedCount = Number(localStorage.getItem(DEVICE_COUNT_KEY) || 0);
    if (cachedCount > 0) setDeviceCount(cachedCount);
  }

  function setSyncState(state, message) {
    installUi();
    const bar = document.getElementById('hanjaSyncBar');
    if (bar) bar.dataset.state = state;
    const text = document.getElementById('hanjaSyncMessage');
    if (text && message) text.textContent = message;
    const button = document.getElementById('hanjaSyncButton');
    if (!button) return;
    if (state === 'synced') {
      button.hidden = false;
      button.textContent = '지금 동기화';
    } else if (state === 'syncing') {
      button.hidden = !!(user && !user.isAnonymous);
      button.textContent = '동기화 중';
    } else if (state === 'signedout') {
      button.hidden = false;
      button.textContent = 'Google로 연동';
    } else if (state === 'offline') {
      button.hidden = !!(user && !user.isAnonymous);
      button.textContent = '오프라인';
    } else if (state === 'error') {
      button.hidden = false;
      button.textContent = user && !user.isAnonymous ? '다시 시도' : 'Google로 연동';
    }
  }

  function setDeviceCount(count) {
    const normalized = Math.max(0, Number(count || 0));
    nativeSetItem.call(localStorage, DEVICE_COUNT_KEY, String(normalized));
    const el = document.getElementById('hanjaSyncDevices');
    if (el) el.textContent = normalized > 0 ? `최근 연동 ${normalized}대` : '이 기기만 사용 중';
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => flushAll(false), 320);
  }

  function onLocalStorageMutation(key, previousValue, nextValue) {
    if (suppressStorage || !WATCHED.has(key) || previousValue === nextValue) return;
    const now = Date.now();
    lastLocalInteractionAt = now;

    if (key === INDEX_KEY) {
      meta.indexUpdatedAtMs = now;
      pendingState = true;
    } else if (key === MASTERY_KEY) {
      const before = parseJson(previousValue);
      const after = parseJson(nextValue);
      const chars = new Set([...Object.keys(before), ...Object.keys(after)]);
      chars.forEach(char => {
        if (before[char] === after[char]) return;
        meta.progress[char] = now;
        pendingProgress.add(char);
      });
    }
    saveMeta();
    scheduleFlush();
  }

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    const watchedLocal = this === localStorage && WATCHED.has(String(key));
    const before = watchedLocal ? this.getItem(key) : null;
    nativeSetItem.call(this, key, value);
    if (watchedLocal) onLocalStorageMutation(String(key), before, String(value));
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    const watchedLocal = this === localStorage && WATCHED.has(String(key));
    const before = watchedLocal ? this.getItem(key) : null;
    nativeRemoveItem.call(this, key);
    if (watchedLocal) onLocalStorageMutation(String(key), before, null);
  };

  async function loadFirebase() {
    if (api) return api;
    if (!CONFIG?.apiKey || !CONFIG?.projectId) throw new Error('firebase-config-missing');
    const [appApi, authApi, firestoreApi] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
    ]);
    const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(CONFIG);
    auth = authApi.getAuth(app);
    db = firestoreApi.getFirestore(app);
    try { await authApi.setPersistence(auth, authApi.browserLocalPersistence); } catch (_) {}
    api = { appApi, authApi, firestoreApi, app };
    return api;
  }

  function refs(uid) {
    const f = api.firestoreApi;
    return {
      state: f.doc(db, 'hanjaUsers', uid, 'state', 'main'),
      progress: f.collection(db, 'hanjaUsers', uid, 'progress'),
      devices: f.collection(db, 'hanjaUsers', uid, 'devices'),
      device: f.doc(db, 'hanjaUsers', uid, 'devices', deviceId),
    };
  }

  function remoteIndex(data) {
    const fallback = Number(data?.currentIndex || 0);
    return data?.currentChar ? indexForChar(data.currentChar, fallback) : fallback;
  }

  function applyRemoteIndex(data) {
    if (!data) return;
    const remoteTs = Number(data.updatedAtMs || 0);
    if (!remoteTs || remoteTs < Number(meta.indexUpdatedAtMs || 0)) return;
    if (Date.now() - lastLocalInteractionAt < 1500) return;

    const nextIndex = remoteIndex(data);
    const currentIndex = safeIndex();
    meta.indexUpdatedAtMs = remoteTs;
    saveMeta();
    if (nextIndex === currentIndex) return;

    suppressStorage = true;
    try {
      nativeSetItem.call(localStorage, INDEX_KEY, String(nextIndex));
      if (typeof index !== 'undefined') index = nextIndex;
      if (typeof render === 'function') render(nextIndex > currentIndex ? 1 : -1);
    } catch (_) {
      // localStorage still has the synced value even if the UI hook is unavailable.
    } finally {
      suppressStorage = false;
    }
  }

  function applyRemoteGrade(char, data) {
    const grade = data?.grade;
    if (!validGrade(grade)) return;
    const remoteTs = Number(data.updatedAtMs || 0);
    const localTs = Number(meta.progress[char] || 0);
    if (remoteTs && remoteTs < localTs) return;

    const current = safeMastery();
    if (current[char] !== grade) {
      current[char] = grade;
      suppressStorage = true;
      try {
        nativeSetItem.call(localStorage, MASTERY_KEY, JSON.stringify(current));
        if (typeof mastery !== 'undefined') mastery[char] = grade;
        if (typeof renderWeakList === 'function') renderWeakList();
      } catch (_) {}
      finally { suppressStorage = false; }
    }
    meta.progress[char] = Math.max(localTs, remoteTs || Date.now());
    saveMeta();
  }

  async function writeState(force = false) {
    if (!user || user.isAnonymous || !db || !navigator.onLine) return false;
    if (!pendingState && !force) return true;
    const f = api.firestoreApi;
    const r = refs(user.uid);
    const now = Math.max(Date.now(), Number(meta.indexUpdatedAtMs || 0));
    const currentIndex = safeIndex();
    const payload = {
      schemaVersion: 1,
      currentIndex,
      currentChar: currentCharFromIndex(currentIndex),
      updatedAtMs: now,
      deviceId,
    };
    await f.setDoc(r.state, payload, { merge: true });
    meta.indexUpdatedAtMs = now;
    pendingState = false;
    saveMeta();
    return true;
  }

  async function writeProgressChar(char, force = false) {
    if (!user || user.isAnonymous || !db || !navigator.onLine) return false;
    const grade = safeMastery()[char];
    if (!validGrade(grade)) {
      pendingProgress.delete(char);
      return true;
    }
    if (!pendingProgress.has(char) && !force) return true;
    const f = api.firestoreApi;
    const r = refs(user.uid);
    const now = Math.max(Date.now(), Number(meta.progress[char] || 0));
    await f.setDoc(f.doc(r.progress, char), {
      schemaVersion: 1,
      char,
      grade,
      updatedAtMs: now,
      deviceId,
    }, { merge: true });
    meta.progress[char] = now;
    pendingProgress.delete(char);
    saveMeta();
    return true;
  }

  async function flushAll(force = false) {
    if (!user || user.isAnonymous || !syncReady) return;
    if (!navigator.onLine) {
      setSyncState('offline', '오프라인 · 변경 사항은 이 기기에 저장되고 연결되면 자동 반영됩니다.');
      return;
    }
    try {
      setSyncState('syncing', '변경 사항을 다른 기기와 맞추는 중…');
      const progressTargets = force ? Object.keys(safeMastery()).filter(char => validGrade(safeMastery()[char])) : [...pendingProgress];
      await writeState(force);
      for (const char of progressTargets) await writeProgressChar(char, force);
      await heartbeatDevice();
      setSyncState('synced', '동기화 완료 · 같은 Google 계정의 기기에서 이어서 공부할 수 있습니다.');
    } catch (error) {
      console.warn('[hanja-sync] flush failed', error);
      setSyncState('error', '동기화에 잠시 실패했습니다. 로컬 학습 기록은 그대로 보존됩니다.');
    }
  }

  async function heartbeatDevice() {
    if (!user || user.isAnonymous || !db || !navigator.onLine) return;
    const f = api.firestoreApi;
    const r = refs(user.uid);
    await f.setDoc(r.device, {
      schemaVersion: 1,
      deviceId,
      label: deviceLabel(),
      deviceType: deviceType(),
      lastSeenAtMs: Date.now(),
    }, { merge: true });
  }

  function stopListeners() {
    while (unsubscribers.length) {
      try { unsubscribers.pop()?.(); } catch (_) {}
    }
    clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
    syncReady = false;
  }

  async function initialMerge(uid) {
    const f = api.firestoreApi;
    const r = refs(uid);
    const [stateSnap, progressSnap] = await Promise.all([
      f.getDoc(r.state),
      f.getDocs(r.progress),
    ]);

    const localGrades = safeMastery();
    const remoteByChar = new Map();
    progressSnap.forEach(docSnap => remoteByChar.set(docSnap.id, docSnap.data()));

    for (const [char, remote] of remoteByChar) {
      const localTs = Number(meta.progress[char] || 0);
      const remoteTs = Number(remote?.updatedAtMs || 0);
      if (localTs > remoteTs && validGrade(localGrades[char])) pendingProgress.add(char);
      else applyRemoteGrade(char, remote);
    }

    for (const [char, grade] of Object.entries(localGrades)) {
      if (!validGrade(grade) || remoteByChar.has(char)) continue;
      meta.progress[char] = Number(meta.progress[char] || Date.now());
      pendingProgress.add(char);
    }

    if (stateSnap.exists()) {
      const remote = stateSnap.data();
      const remoteTs = Number(remote.updatedAtMs || 0);
      if (Number(meta.indexUpdatedAtMs || 0) > remoteTs) pendingState = true;
      else applyRemoteIndex(remote);
    } else {
      meta.indexUpdatedAtMs = Number(meta.indexUpdatedAtMs || Date.now());
      pendingState = true;
    }
    saveMeta();
  }

  function startRealtime(uid) {
    const f = api.firestoreApi;
    const r = refs(uid);

    unsubscribers.push(f.onSnapshot(r.state, snap => {
      if (snap.exists() && !snap.metadata?.hasPendingWrites) applyRemoteIndex(snap.data());
    }, error => console.warn('[hanja-sync] state listener', error)));

    unsubscribers.push(f.onSnapshot(r.progress, snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'removed' || change.doc.metadata?.hasPendingWrites) return;
        applyRemoteGrade(change.doc.id, change.doc.data());
      });
    }, error => console.warn('[hanja-sync] progress listener', error)));

    unsubscribers.push(f.onSnapshot(r.devices, snapshot => {
      const activeCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let count = 0;
      snapshot.forEach(docSnap => {
        if (Number(docSnap.data()?.lastSeenAtMs || 0) >= activeCutoff) count += 1;
      });
      setDeviceCount(count);
    }, error => console.warn('[hanja-sync] devices listener', error)));
  }

  async function startUserSync(nextUser) {
    stopListeners();
    user = nextUser;
    if (!user || user.isAnonymous) {
      setSyncState('signedout', 'Google 계정으로 연결하면 학습 위치와 숙련도가 모든 기기에서 이어집니다.');
      return;
    }

    setSyncState('syncing', '이 기기와 클라우드의 학습 기록을 처음 맞추는 중…');
    try {
      await initialMerge(user.uid);
      syncReady = true;
      await heartbeatDevice();
      startRealtime(user.uid);
      await flushAll(false);
      heartbeatTimer = window.setInterval(() => heartbeatDevice().catch(() => {}), 5 * 60 * 1000);
      setSyncState('synced', '동기화 완료 · 같은 Google 계정의 기기에서 이어서 공부할 수 있습니다.');
    } catch (error) {
      console.warn('[hanja-sync] initial sync failed', error);
      syncReady = true;
      setSyncState('error', error?.code === 'permission-denied'
        ? '클라우드 연동 규칙 배포를 기다리는 중입니다. 로컬 기록은 안전하게 유지됩니다.'
        : '클라우드 연결에 실패했습니다. 로컬 기록은 그대로 유지됩니다.');
    }
  }

  async function signInWithGoogle() {
    try {
      setSyncState('syncing', 'Google 계정 연결을 준비하는 중…');
      await loadFirebase();
      const a = api.authApi;
      const provider = new a.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') || matchMedia('(display-mode: standalone)').matches;
      if (mobile) {
        await a.signInWithRedirect(auth, provider);
        return;
      }
      try {
        await a.signInWithPopup(auth, provider);
      } catch (error) {
        if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request') {
          await a.signInWithRedirect(auth, provider);
          return;
        }
        throw error;
      }
    } catch (error) {
      console.warn('[hanja-sync] sign in failed', error);
      setSyncState('error', 'Google 계정 연결에 실패했습니다. 잠시 뒤 다시 시도할 수 있습니다.');
    }
  }

  async function initFirebaseAuth() {
    try {
      await loadFirebase();
      const a = api.authApi;
      try { await a.getRedirectResult(auth); } catch (error) { console.warn('[hanja-sync] redirect result', error); }
      a.onAuthStateChanged(auth, nextUser => startUserSync(nextUser));
    } catch (error) {
      console.warn('[hanja-sync] firebase init failed', error);
      setSyncState('error', 'Pincon 계정 연동을 준비하지 못했습니다. 이 기기의 기록은 계속 저장됩니다.');
    }
  }

  function init() {
    installUi();
    window.addEventListener('online', () => {
      if (user && !user.isAnonymous) {
        setSyncState('syncing', '인터넷에 다시 연결되었습니다. 변경 사항을 맞추는 중…');
        flushAll(false);
        heartbeatDevice().catch(() => {});
      }
    });
    window.addEventListener('offline', () => setSyncState('offline', '오프라인 · 변경 사항은 이 기기에 저장되고 연결되면 자동 반영됩니다.'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && user && !user.isAnonymous) heartbeatDevice().catch(() => {});
    });
    initFirebaseAuth();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
