// Independent anonymous presence for the two ALTERWAY pages on PinCon.
async function connectAlterwayPresence({ viewer, onChange }) {
  const empty = { status: 'local', people: [], ownId: null };
  if (location.origin !== 'https://pincon.app') {
    onChange(empty);
    return;
  }

  let status = 'connecting';
  let records = [];
  let ownId = null;
  let clockOffset = 0;
  let failed = false;
  function publish() {
    const cutoff = Date.now() + clockOffset - 95000;
    onChange({ status, ownId, people: records.filter((record) => record.seenAt > cutoff).map((record) => record.id) });
  }
  function reportError(error) {
    failed = true;
    status = 'unavailable';
    records = [];
    publish();
    console.warn('ALTERWAY presence:', error.code || error.message);
  }
  const connectionTimeout = setTimeout(() => {
    if (status === 'connecting') { status = 'waiting'; publish(); }
  }, 8000);

  try {
    await import('/firebase-config.js');
    const config = globalThis.PINCON_FIREBASE_CONFIG;
    if (!config?.projectId || !config.apiKey) throw Error('PinCon Firebase configuration is missing');
    const sdk = 'https://www.gstatic.com/firebasejs/12.16.0/';
    const [appSdk, authSdk, dbSdk] = await Promise.all([
      import(sdk + 'firebase-app.js'),
      import(sdk + 'firebase-auth.js'),
      import(sdk + 'firebase-firestore.js'),
    ]);
    const app = appSdk.initializeApp(config, 'alterway-presence-v1');
    const auth = authSdk.initializeAuth(app, { persistence: authSdk.browserSessionPersistence });
    await auth.authStateReady();
    const user = auth.currentUser || (await authSdk.signInAnonymously(auth)).user;
    if (!user.isAnonymous) throw Error('ALTERWAY requires an anonymous session');
    ownId = viewer ? user.uid : null;

    const db = dbSdk.getFirestore(app);
    const collection = dbSdk.collection(db, 'alterwayPresenceV1');
    const roster = dbSdk.query(collection, dbSdk.orderBy('seenAt', 'desc'), dbSdk.limit(150));
    const ref = viewer ? dbSdk.doc(collection, user.uid) : null;
    let lastSyncedHeartbeat = 0;
    dbSdk.onSnapshot(roster, { includeMetadataChanges: true }, (snapshot) => {
      if (failed) return;
      const now = Date.now();
      records = snapshot.docs.flatMap((item) => {
        const seenAt = item.data({ serverTimestamps: 'previous' }).seenAt?.toMillis?.();
        if (!Number.isFinite(seenAt)) return [];
        if (item.id === ownId && !item.metadata.hasPendingWrites) {
          // A committed heartbeat gives viewers a rough offset if the phone clock is off.
          if (seenAt > lastSyncedHeartbeat) {
            lastSyncedHeartbeat = seenAt;
            clockOffset = seenAt - now;
          }
        }
        return [{ id: item.id, seenAt }];
      });
      if (!snapshot.metadata.fromCache) {
        clearTimeout(connectionTimeout);
        status = 'live';
      } else if (status === 'live') {
        status = 'waiting';
      }
      publish();
    }, reportError);

    let pending = false;
    async function heartbeat() {
      if (!ref || pending || failed || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        await dbSdk.setDoc(ref, {
          seenAt: dbSdk.serverTimestamp(),
          expiresAt: dbSdk.Timestamp.fromMillis(Date.now() + clockOffset + 600000),
        });
      } catch (error) {
        reportError(error);
      } finally {
        pending = false;
      }
    }

    if (viewer) {
      setInterval(heartbeat, 30000);
      document.addEventListener('visibilitychange', heartbeat);
      window.addEventListener('pageshow', heartbeat);
      window.addEventListener('online', heartbeat);
      void heartbeat();
    }
    window.addEventListener('offline', () => {
      if (!failed) { status = 'waiting'; publish(); }
    });
    setInterval(publish, 3000);
  } catch (error) {
    clearTimeout(connectionTimeout);
    reportError(error);
  }
}
