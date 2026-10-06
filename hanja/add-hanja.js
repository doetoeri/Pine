(() => {
  const CUSTOM_KEY = 'pincon-hanja-custom-v1';
  const SDK = '12.16.0';
  const AI_ENDPOINT = 'https://pincon-ai.vercel.app/api/hanja-draft';
  const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
  const HAN_GLOBAL_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/gu;
  const builtinChars = new Set(typeof hanjaSet !== 'undefined' ? hanjaSet.map((item) => item.char) : []);
  let customEntries = readCustom();
  let dialog = null;
  let singleDraft = null;
  let batchDrafts = [];
  let draftTimer = 0;
  let firebase = null;
  let cloudUnsub = null;

  function text(value, max = 1000) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  }

  function normalizeParts(value) {
    return (Array.isArray(value) ? value : []).slice(0, 8).map((row) => [
      text(Array.isArray(row) ? row[0] : row?.char, 8),
      text(Array.isArray(row) ? row[1] : row?.label, 40),
      text(Array.isArray(row) ? row[2] : row?.note, 100),
    ]).filter((row) => row[0]);
  }

  function normalizeUsage(value) {
    return (Array.isArray(value) ? value : []).slice(0, 6).map((row) => [
      text(Array.isArray(row) ? row[0] : row?.word, 20),
      text(Array.isArray(row) ? row[1] : row?.reading, 40),
      text(Array.isArray(row) ? row[2] : row?.note, 120),
    ]).filter((row) => row[0]);
  }

  function normalizeEntry(value, { preserveTimes = true } = {}) {
    const char = Array.from(text(value?.char, 4))[0] || '';
    const now = Date.now();
    return {
      char,
      hun: text(value?.hun, 30),
      eum: text(value?.eum, 20),
      strokes: Math.max(0, Math.min(80, Number(value?.strokes || 0))),
      parts: normalizeParts(value?.parts),
      structure: text(value?.structure, 800),
      origin: text(value?.origin, 1000),
      memory: text(value?.memory, 600),
      usage: normalizeUsage(value?.usage),
      originExtra: {
        type: text(value?.originExtra?.type, 60),
        key: text(value?.originExtra?.key, 100),
        era: text(value?.originExtra?.era, 100),
        origin: text(value?.originExtra?.origin || value?.origin, 1000),
        deep: text(value?.originExtra?.deep, 1400),
        caution: text(value?.originExtra?.caution, 800),
      },
      custom: true,
      createdAtMs: preserveTimes ? Number(value?.createdAtMs || now) : now,
      updatedAtMs: preserveTimes ? Number(value?.updatedAtMs || now) : now,
    };
  }

  function readCustom() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed.map((item) => normalizeEntry(item)).filter((item) => {
        if (!item.char || !HAN_RE.test(item.char) || builtinChars.has(item.char) || seen.has(item.char)) return false;
        seen.add(item.char);
        return true;
      }).sort((a, b) => a.createdAtMs - b.createdAtMs || a.char.localeCompare(b.char));
    } catch (_) { return []; }
  }

  function writeCustom(entries = customEntries) {
    customEntries = entries.map((item) => normalizeEntry(item)).filter((item) => item.char && !builtinChars.has(item.char));
    customEntries.sort((a, b) => a.createdAtMs - b.createdAtMs || a.char.localeCompare(b.char));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customEntries));
  }

  function hydrateIntoSet() {
    if (typeof hanjaSet === 'undefined' || !Array.isArray(hanjaSet)) return;
    const existing = new Set(hanjaSet.map((item) => item.char));
    customEntries.forEach((entry) => {
      if (!existing.has(entry.char)) {
        hanjaSet.push(entry);
        existing.add(entry.char);
      }
    });
    const storedIndex = Number(localStorage.getItem('pincon-hanja-index') || 0);
    if (Number.isFinite(storedIndex) && storedIndex >= 0 && storedIndex < hanjaSet.length) {
      try { index = storedIndex; } catch (_) {}
    }
    try { if (typeof render === 'function') render(); } catch (_) {}
  }

  hydrateIntoSet();

  function existingItem(char) {
    try { return hanjaSet.find((item) => item.char === char) || null; }
    catch (_) { return null; }
  }

  async function strokeCount(char) {
    if (!char || !window.HanziWriter?.loadCharacterData) return 0;
    try {
      const data = await HanziWriter.loadCharacterData(char);
      return Array.isArray(data?.strokes) ? data.strokes.length : 0;
    } catch (_) { return 0; }
  }

  async function firebaseApi() {
    if (firebase) return firebase;
    const config = globalThis.PINCON_FIREBASE_CONFIG || {};
    if (!config.apiKey || !config.projectId) throw new Error('Firebase 설정 없음');
    const [appApi, authApi, firestoreApi] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
    ]);
    const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(config);
    const auth = authApi.getAuth(app);
    const db = firestoreApi.getFirestore(app);
    try { await auth.authStateReady?.(); } catch (_) {}
    firebase = { appApi, authApi, firestoreApi, app, auth, db };
    return firebase;
  }

  async function signedUser() {
    const api = await firebaseApi();
    const user = api.auth.currentUser;
    if (!user || user.isAnonymous) throw new Error('Google 계정 연동이 필요합니다. 위의 “모든 기기 연동”에서 먼저 연결해주세요.');
    return { api, user };
  }

  async function requestAiDraft(chars) {
    const clean = [...new Set(chars.filter((char) => HAN_RE.test(char)))].slice(0, 16);
    if (!clean.length) return [];
    const { user } = await signedUser();
    const token = await user.getIdToken();
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ chars: clean }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.ok) {
      if (response.status === 403) throw new Error('AI 초안은 Google 계정 연동 후 사용할 수 있습니다.');
      if (response.status === 503) throw new Error('AI 초안 서버가 아직 준비되지 않았습니다. 획수 자동 인식과 수동 입력은 그대로 사용할 수 있습니다.');
      throw new Error('AI 초안을 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
    return Array.isArray(body.entries) ? body.entries.map((entry) => normalizeEntry(entry, { preserveTimes: false })) : [];
  }

  function blankEntry(char = '') {
    return normalizeEntry({
      char,
      hun: '', eum: '', strokes: 0,
      parts: char ? [[char, '전체 자형', '구성 확인 필요']] : [],
      structure: '', origin: '', memory: '', usage: [],
      originExtra: { type: '', key: '', era: '', origin: '', deep: '', caution: '' },
    }, { preserveTimes: false });
  }

  function setStatus(message, tone = 'muted') {
    const status = dialog?.querySelector('#addHanjaStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function addRow(kind, values = ['', '', '']) {
    const list = dialog?.querySelector(kind === 'part' ? '#addPartList' : '#addUsageList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = kind === 'part' ? 'part-row' : 'usage-row';
    const placeholders = kind === 'part' ? ['구성', '이름', '역할·위치'] : ['한자어', '읽기', '뜻·구성'];
    row.innerHTML = `${values.slice(0, 3).map((value, i) => `<input type="text" value="${escapeAttr(value)}" placeholder="${placeholders[i]}">`).join('')}<button class="row-remove" type="button" aria-label="행 삭제">×</button>`;
    row.querySelector('.row-remove').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fillSingle(entry) {
    singleDraft = normalizeEntry(entry);
    const q = (id) => dialog.querySelector(`#${id}`);
    q('addChar').value = singleDraft.char;
    q('addHun').value = singleDraft.hun;
    q('addEum').value = singleDraft.eum;
    q('addStrokes').value = singleDraft.strokes || '';
    q('addStructure').value = singleDraft.structure;
    q('addOrigin').value = singleDraft.origin;
    q('addMemory').value = singleDraft.memory;
    q('addOriginType').value = singleDraft.originExtra.type;
    q('addOriginKey').value = singleDraft.originExtra.key;
    q('addOriginEra').value = singleDraft.originExtra.era;
    q('addOriginDeep').value = singleDraft.originExtra.deep;
    q('addOriginCaution').value = singleDraft.originExtra.caution;
    q('addPartList').innerHTML = '';
    q('addUsageList').innerHTML = '';
    (singleDraft.parts.length ? singleDraft.parts : [['', '', '']]).forEach((row) => addRow('part', row));
    (singleDraft.usage.length ? singleDraft.usage : [['', '', '']]).forEach((row) => addRow('usage', row));
  }

  function collectRows(selector) {
    return [...dialog.querySelectorAll(`${selector} > div`)].map((row) => [...row.querySelectorAll('input')].map((input) => input.value.trim())).filter((row) => row[0]);
  }

  function collectSingle() {
    const q = (id) => dialog.querySelector(`#${id}`);
    const char = Array.from(q('addChar').value.trim())[0] || '';
    const now = Date.now();
    return normalizeEntry({
      char,
      hun: q('addHun').value,
      eum: q('addEum').value,
      strokes: Number(q('addStrokes').value || 0),
      parts: collectRows('#addPartList'),
      structure: q('addStructure').value,
      origin: q('addOrigin').value,
      memory: q('addMemory').value,
      usage: collectRows('#addUsageList'),
      originExtra: {
        type: q('addOriginType').value,
        key: q('addOriginKey').value,
        era: q('addOriginEra').value,
        origin: q('addOrigin').value,
        deep: q('addOriginDeep').value,
        caution: q('addOriginCaution').value,
      },
      createdAtMs: singleDraft?.createdAtMs || now,
      updatedAtMs: now,
    });
  }

  async function prepareSingle(char, useAi = true) {
    if (!char || !HAN_RE.test(char)) {
      setStatus('한자 한 글자를 입력해주세요.');
      return;
    }
    const existing = existingItem(char);
    if (existing) {
      setStatus(existing.custom ? '이미 추가한 한자입니다.' : '기본 학습 목록에 이미 있는 한자입니다.');
      dialog.querySelector('#saveSingleHanja').disabled = true;
      return;
    }
    dialog.querySelector('#saveSingleHanja').disabled = false;
    setStatus('획수를 확인하는 중…');
    let draft = blankEntry(char);
    draft.strokes = await strokeCount(char);
    fillSingle(draft);
    setStatus(draft.strokes ? `${draft.strokes}획을 확인했습니다. AI 초안을 불러오는 중…` : '획순 데이터를 찾지 못했습니다. 획수는 직접 입력할 수 있습니다.');
    if (!useAi) return;
    try {
      const [ai] = await requestAiDraft([char]);
      if (ai) {
        ai.strokes = draft.strokes;
        fillSingle(ai);
        setStatus('AI 초안을 채웠습니다. 저장하기 전에 훈·음·유래를 한 번 검토하세요.', 'ok');
      } else setStatus('AI 응답이 비어 있습니다. 필요한 내용을 직접 채워주세요.');
    } catch (error) {
      setStatus(error.message || 'AI 초안을 불러오지 못했습니다.');
    }
  }

  function extractChars(value) {
    return [...new Set((String(value || '').match(HAN_GLOBAL_RE) || []))].slice(0, 80);
  }

  function renderBatchRows() {
    const list = dialog.querySelector('#batchDraftList');
    if (!batchDrafts.length) {
      list.innerHTML = '<div class="batch-empty">학습지에서 한자를 붙여넣고 “자동 초안 만들기”를 누르세요.</div>';
      dialog.querySelector('#saveBatchHanja').disabled = true;
      return;
    }
    list.innerHTML = batchDrafts.map((entry, i) => {
      const duplicate = Boolean(existingItem(entry.char));
      const ready = entry.hun && entry.eum;
      return `<div class="batch-row" data-batch-index="${i}">
        <input type="checkbox" ${duplicate ? 'disabled' : 'checked'} aria-label="${entry.char} 저장">
        <span class="batch-char">${entry.char}</span>
        <input type="text" data-field="hun" value="${escapeAttr(entry.hun)}" placeholder="훈">
        <input type="text" data-field="eum" value="${escapeAttr(entry.eum)}" placeholder="음">
        <span class="batch-strokes">${entry.strokes || '?'}획</span>
        <span class="batch-state" data-state="${duplicate ? 'warn' : ready ? 'ready' : 'warn'}">${duplicate ? '이미 있음' : ready ? '초안 완료' : '검토 필요'}</span>
      </div>`;
    }).join('');
    list.querySelectorAll('.batch-row').forEach((row) => {
      const i = Number(row.dataset.batchIndex);
      row.querySelectorAll('input[data-field]').forEach((input) => input.addEventListener('input', () => {
        batchDrafts[i][input.dataset.field] = input.value.trim();
      }));
    });
    dialog.querySelector('#saveBatchHanja').disabled = !batchDrafts.some((entry) => !existingItem(entry.char));
  }

  async function prepareBatch() {
    const chars = extractChars(dialog.querySelector('#batchHanjaText').value);
    const fresh = chars.filter((char) => !existingItem(char));
    dialog.querySelector('#batchCount').textContent = `${chars.length}자 인식 · ${fresh.length}자 새로 추가 가능`;
    if (!fresh.length) {
      batchDrafts = chars.map((char) => normalizeEntry(existingItem(char) || blankEntry(char)));
      renderBatchRows();
      return;
    }
    const button = dialog.querySelector('#makeBatchDraft');
    button.disabled = true;
    button.textContent = '초안 만드는 중…';
    const strokeMap = new Map(await Promise.all(fresh.map(async (char) => [char, await strokeCount(char)])));
    const aiMap = new Map();
    try {
      for (let i = 0; i < fresh.length; i += 16) {
        const result = await requestAiDraft(fresh.slice(i, i + 16));
        result.forEach((entry) => aiMap.set(entry.char, entry));
      }
    } catch (error) {
      setStatus(error.message || 'AI 초안 중 일부를 만들지 못했습니다.');
    }
    batchDrafts = chars.map((char) => {
      const existing = existingItem(char);
      if (existing) return normalizeEntry(existing);
      const entry = aiMap.get(char) || blankEntry(char);
      entry.strokes = strokeMap.get(char) || entry.strokes || 0;
      return entry;
    });
    renderBatchRows();
    button.disabled = false;
    button.textContent = '✦ 자동 초안 만들기';
  }

  function mergeLocalEntries(entries) {
    const map = new Map(customEntries.map((entry) => [entry.char, entry]));
    entries.forEach((raw) => {
      const entry = normalizeEntry(raw);
      if (!entry.char || builtinChars.has(entry.char)) return;
      const previous = map.get(entry.char);
      entry.createdAtMs = previous?.createdAtMs || entry.createdAtMs || Date.now();
      entry.updatedAtMs = Date.now();
      map.set(entry.char, entry);
    });
    writeCustom([...map.values()]);
  }

  async function uploadEntries(entries) {
    try {
      const { api, user } = await signedUser();
      const f = api.firestoreApi;
      await Promise.all(entries.map((raw) => {
        const entry = normalizeEntry(raw);
        return f.setDoc(f.doc(api.db, 'hanjaUsers', user.uid, 'customEntries', entry.char), {
          schemaVersion: 1,
          ...entry,
          updatedAtMs: Date.now(),
        }, { merge: true });
      }));
      return true;
    } catch (_) { return false; }
  }

  async function saveSingle() {
    const entry = collectSingle();
    if (!entry.char || !HAN_RE.test(entry.char)) return setStatus('한자 한 글자를 입력해주세요.');
    if (builtinChars.has(entry.char)) return setStatus('기본 학습 목록에 이미 있는 한자입니다.');
    if (!entry.hun || !entry.eum) return setStatus('훈과 음은 반드시 확인해서 입력해주세요.');
    if (!entry.strokes) return setStatus('획수를 확인해주세요.');
    mergeLocalEntries([entry]);
    setStatus('저장했습니다. 전체 한자 목록을 새로 맞추는 중…', 'ok');
    uploadEntries([entry]);
    localStorage.setItem('pincon-hanja-index', String((typeof hanjaSet !== 'undefined' ? hanjaSet.length : 1)));
    setTimeout(() => location.reload(), 180);
  }

  async function saveBatch() {
    const selected = [...dialog.querySelectorAll('.batch-row')].filter((row) => row.querySelector('input[type="checkbox"]')?.checked).map((row) => {
      const i = Number(row.dataset.batchIndex);
      const entry = normalizeEntry(batchDrafts[i]);
      entry.hun = row.querySelector('[data-field="hun"]').value.trim();
      entry.eum = row.querySelector('[data-field="eum"]').value.trim();
      return entry;
    }).filter((entry) => entry.char && !existingItem(entry.char));
    const invalid = selected.filter((entry) => !entry.hun || !entry.eum || !entry.strokes);
    if (invalid.length) {
      setStatus(`${invalid.map((entry) => entry.char).join(' · ')}의 훈·음·획수를 먼저 확인해주세요.`);
      return;
    }
    if (!selected.length) return setStatus('저장할 새 한자를 선택해주세요.');
    mergeLocalEntries(selected);
    setStatus(`${selected.length}자를 저장했습니다. 목록을 갱신합니다.`, 'ok');
    uploadEntries(selected);
    setTimeout(() => location.reload(), 220);
  }

  function dialogMarkup() {
    return `<div class="hanja-add-shell">
      <header class="hanja-add-head"><div><p>PINCON HANJA</p><h2>한자 추가</h2></div><button class="hanja-add-close" type="button" aria-label="닫기">×</button></header>
      <div class="hanja-add-tabs" role="tablist"><button type="button" class="is-active" data-add-tab="single">한 글자</button><button type="button" data-add-tab="batch">여러 글자 붙여넣기</button></div>
      <div class="hanja-add-body">
        <div class="hanja-add-pane" data-add-pane="single">
          <div class="add-lead"><input id="addChar" class="add-char-input" maxlength="2" inputmode="text" autocomplete="off" aria-label="추가할 한자"><div class="add-lead-copy"><strong>한 글자만 입력하면 초안을 만듭니다.</strong><p>획수는 획순 데이터에서 확인하고, 훈·음·구조·유래·쓰임은 AI가 초안을 만듭니다. AI 내용은 저장 전 직접 검토합니다.</p><div id="addHanjaStatus" class="add-status" data-tone="muted">한자를 입력해주세요.</div></div></div>
          <div class="add-draft-actions"><button type="button" class="primary" id="refreshAiDraft">✦ AI 초안 다시 만들기</button><span class="ai-badge">검토 후 저장</span></div>
          <div class="add-form-grid">
            <div class="add-field"><label for="addHun">훈</label><input id="addHun" placeholder="예: 배울"></div>
            <div class="add-field"><label for="addEum">음</label><input id="addEum" placeholder="예: 학"></div>
            <div class="add-field stroke-field"><label for="addStrokes">획수</label><input id="addStrokes" type="number" min="1" max="80" placeholder="자동"></div>
            <div class="add-field wide"><label for="addStructure">구조 설명</label><textarea id="addStructure" placeholder="현재 자형을 어떻게 나누어 보면 좋은지"></textarea></div>
            <div class="add-field wide"><label for="addOrigin">실제 유래</label><textarea id="addOrigin" placeholder="자원 설명. 불확실한 부분은 단정하지 않습니다."></textarea></div>
            <div class="add-field wide"><label for="addMemory">암기용 기억법</label><textarea id="addMemory" placeholder="실제 유래와 분리된 기억 고리"></textarea></div>
          </div>
          <section class="editor-section"><div class="editor-section-head"><span class="mini-section-title">구성 요소</span><button type="button" id="addPartRow">＋ 구성 추가</button></div><div class="part-list" id="addPartList"></div></section>
          <section class="editor-section"><div class="editor-section-head"><span class="mini-section-title">쓰임 · 한자어</span><button type="button" id="addUsageRow">＋ 단어 추가</button></div><div class="usage-list" id="addUsageList"></div></section>
          <details class="origin-details"><summary>유래 상세 정보</summary><div class="origin-detail-body">
            <div class="add-field"><label for="addOriginType">짜임</label><input id="addOriginType" placeholder="형성자 · 회의 계열…"></div>
            <div class="add-field"><label for="addOriginKey">핵심 구조</label><input id="addOriginKey" placeholder="예: 糹 + 吉"></div>
            <div class="add-field wide"><label for="addOriginEra">자형 시대</label><input id="addOriginEra" placeholder="갑골문·금문·전서 등"></div>
            <div class="add-field wide"><label for="addOriginDeep">상세 설명</label><textarea id="addOriginDeep"></textarea></div>
            <div class="add-field wide"><label for="addOriginCaution">자원 주의</label><textarea id="addOriginCaution"></textarea></div>
          </div></details>
          <div class="add-footer"><span class="add-footer-note">AI 초안은 참고용입니다. 훈·음과 자원은 학습지 기준으로 마지막 확인을 권장합니다.</span><button class="primary" id="saveSingleHanja" type="button">저장하고 목록에 추가</button></div>
        </div>
        <div class="hanja-add-pane" data-add-pane="batch" hidden>
          <textarea id="batchHanjaText" class="batch-textarea" placeholder="학습지에서 그대로 붙여넣으세요.\n예: 父 母 子 女 兄 弟 姉 妹 男 夫 婦 結 婚"></textarea>
          <div class="batch-helper"><span>문장 속에 섞여 있어도 한자만 추출합니다.</span><strong id="batchCount">0자 인식</strong></div>
          <div class="batch-actions"><button class="primary" id="makeBatchDraft" type="button">✦ 자동 초안 만들기</button><button id="selectFreshBatch" type="button">새 글자만 선택</button></div>
          <div id="batchDraftList" class="batch-list"><div class="batch-empty">학습지에서 한자를 붙여넣고 “자동 초안 만들기”를 누르세요.</div></div>
          <div class="add-footer"><span class="add-footer-note">한꺼번에 저장해도 각 글자의 학습 기록은 따로 관리됩니다.</span><button class="primary" id="saveBatchHanja" type="button" disabled>선택한 한자 저장</button></div>
        </div>
      </div>
    </div>`;
  }

  function switchPane(name) {
    dialog.querySelectorAll('[data-add-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.addTab === name));
    dialog.querySelectorAll('[data-add-pane]').forEach((pane) => { pane.hidden = pane.dataset.addPane !== name; });
  }

  function openDialog(tab = 'single') {
    if (!dialog) return;
    switchPane(tab);
    dialog.showModal();
    if (tab === 'single') setTimeout(() => dialog.querySelector('#addChar')?.focus(), 40);
  }

  function installDialog() {
    if (document.getElementById('hanjaAddDialog')) return;
    dialog = document.createElement('dialog');
    dialog.id = 'hanjaAddDialog';
    dialog.className = 'hanja-add-dialog';
    dialog.innerHTML = dialogMarkup();
    document.body.appendChild(dialog);
    fillSingle(blankEntry(''));
    dialog.querySelector('.hanja-add-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll('[data-add-tab]').forEach((button) => button.addEventListener('click', () => switchPane(button.dataset.addTab)));
    dialog.querySelector('#addPartRow').addEventListener('click', () => addRow('part'));
    dialog.querySelector('#addUsageRow').addEventListener('click', () => addRow('usage'));
    dialog.querySelector('#saveSingleHanja').addEventListener('click', saveSingle);
    dialog.querySelector('#saveBatchHanja').addEventListener('click', saveBatch);
    dialog.querySelector('#makeBatchDraft').addEventListener('click', prepareBatch);
    dialog.querySelector('#selectFreshBatch').addEventListener('click', () => dialog.querySelectorAll('.batch-row').forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (checkbox && !checkbox.disabled) checkbox.checked = true;
    }));
    dialog.querySelector('#refreshAiDraft').addEventListener('click', () => {
      const char = Array.from(dialog.querySelector('#addChar').value.trim())[0] || '';
      prepareSingle(char, true);
    });
    dialog.querySelector('#addChar').addEventListener('input', (event) => {
      const chars = extractChars(event.target.value);
      const char = chars[0] || '';
      event.target.value = char;
      clearTimeout(draftTimer);
      if (!char) { fillSingle(blankEntry('')); setStatus('한자를 입력해주세요.'); return; }
      draftTimer = setTimeout(() => prepareSingle(char, true), 420);
    });
    dialog.querySelector('#batchHanjaText').addEventListener('input', (event) => {
      const chars = extractChars(event.target.value);
      const fresh = chars.filter((char) => !existingItem(char));
      dialog.querySelector('#batchCount').textContent = `${chars.length}자 인식 · ${fresh.length}자 새로 추가 가능`;
    });
  }

  function installTriggers() {
    const topbar = document.querySelector('.topbar');
    const search = document.getElementById('searchButton');
    if (topbar && search && !document.getElementById('addHanjaTopButton')) {
      const button = document.createElement('button');
      button.id = 'addHanjaTopButton';
      button.className = 'hanja-add-trigger';
      button.type = 'button';
      button.innerHTML = '<span class="plus">＋</span><span>한자 추가</span>';
      button.addEventListener('click', () => openDialog('single'));
      topbar.insertBefore(button, search);
    }
    const head = document.querySelector('.hanja-roster-head');
    if (head && !head.querySelector('.hanja-add-trigger')) {
      const button = document.createElement('button');
      button.className = 'hanja-add-trigger';
      button.type = 'button';
      button.innerHTML = '<span class="plus">＋</span><span>추가</span>';
      button.addEventListener('click', () => openDialog('single'));
      head.appendChild(button);
    }
  }

  function appendCustomOrigin() {
    const panel = document.getElementById('detailPanel');
    if (!panel || panel.querySelector('.custom-origin-extra')) return;
    const active = document.querySelector('.mode-tab.is-active')?.dataset.mode;
    if (active !== 'origin') return;
    const char = document.getElementById('mainChar')?.textContent.trim();
    const item = customEntries.find((entry) => entry.char === char);
    const info = item?.originExtra;
    if (!info || !(info.deep || info.caution || info.type || info.key || info.era)) return;
    const box = document.createElement('div');
    box.className = 'custom-origin-extra';
    box.innerHTML = `<div class="custom-origin-meta">${[
      info.type && `짜임 · ${info.type}`,
      info.key && `구조 · ${info.key}`,
      info.era && `자형 · ${info.era}`,
    ].filter(Boolean).map((value) => `<span>${value}</span>`).join('')}</div>${info.deep ? `<p>${info.deep}</p>` : ''}${info.caution ? `<p class="custom-origin-caution"><strong>자원 주의</strong> · ${info.caution}</p>` : ''}`;
    panel.appendChild(box);
  }

  function installOriginObserver() {
    const panel = document.getElementById('detailPanel');
    if (!panel) return;
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; appendCustomOrigin(); });
    }).observe(panel, { childList: true, subtree: true });
    document.querySelectorAll('.mode-tab').forEach((tab) => tab.addEventListener('click', () => setTimeout(appendCustomOrigin, 0)));
    appendCustomOrigin();
  }

  function stableJson(entries) {
    return JSON.stringify(entries.map((entry) => normalizeEntry(entry)).sort((a, b) => a.char.localeCompare(b.char)));
  }

  async function startCloudCustomSync() {
    try {
      const api = await firebaseApi();
      api.authApi.onAuthStateChanged(api.auth, async (user) => {
        if (cloudUnsub) { cloudUnsub(); cloudUnsub = null; }
        if (!user || user.isAnonymous) return;
        const f = api.firestoreApi;
        const collectionRef = f.collection(api.db, 'hanjaUsers', user.uid, 'customEntries');

        const reconcile = async (snapshot, uploadLocal = false) => {
          const remote = [];
          snapshot.forEach((docSnap) => remote.push(normalizeEntry(docSnap.data())));
          const merged = new Map();
          [...remote, ...customEntries].forEach((entry) => {
            if (!entry.char || builtinChars.has(entry.char)) return;
            const previous = merged.get(entry.char);
            if (!previous || entry.updatedAtMs >= previous.updatedAtMs) merged.set(entry.char, entry);
          });
          const next = [...merged.values()].sort((a, b) => a.createdAtMs - b.createdAtMs || a.char.localeCompare(b.char));
          const changed = stableJson(next) !== stableJson(customEntries);
          if (changed) {
            writeCustom(next);
            sessionStorage.setItem('pincon-hanja-custom-cloud-merge', String(Date.now()));
            setTimeout(() => location.reload(), 80);
            return;
          }
          if (uploadLocal) {
            const remoteSet = new Map(remote.map((entry) => [entry.char, entry]));
            const missing = customEntries.filter((entry) => !remoteSet.has(entry.char) || entry.updatedAtMs > remoteSet.get(entry.char).updatedAtMs);
            if (missing.length) uploadEntries(missing);
          }
        };

        const initial = await f.getDocs(collectionRef);
        await reconcile(initial, true);
        cloudUnsub = f.onSnapshot(collectionRef, (snapshot) => reconcile(snapshot, false).catch(() => {}));
      });
    } catch (_) {}
  }

  function init() {
    installDialog();
    installOriginObserver();
    requestAnimationFrame(installTriggers);
    const mo = new MutationObserver(installTriggers);
    mo.observe(document.body, { childList: true, subtree: true });
    startCloudCustomSync();
    window.PinconHanjaAdd = { open: openDialog, extractChars };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
