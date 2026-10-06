(() => {
  const HISTORY_KEY = 'pincon-hanja-test-history-v1';
  let dialog = null;
  let session = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  function allItems() {
    try { return Array.isArray(hanjaSet) ? hanjaSet.filter((item) => item?.char && item?.hun && item?.eum) : []; }
    catch (_) { return []; }
  }

  function termBank() { return Array.isArray(window.HANJA_TERM_BANK) ? window.HANJA_TERM_BANK : []; }

  function injectTrigger() {
    if ($('#hanjaTestTrigger')) return;
    const nav = document.querySelector('.topnav');
    const button = document.createElement('button');
    button.id = 'hanjaTestTrigger';
    button.className = 'topnav-item hanja-test-trigger';
    button.type = 'button';
    button.innerHTML = '<span aria-hidden="true">✓</span> 시험 모드';
    button.addEventListener('click', openSetup);
    nav?.appendChild(button);

    const weak = document.querySelector('.weak-section');
    if (weak && !$('#hanjaTestCard')) {
      const card = document.createElement('section');
      card.id = 'hanjaTestCard';
      card.className = 'hanja-test-card';
      card.innerHTML = '<div><span class="test-kicker">TEST</span><strong>시험처럼 바로 확인</strong><p>훈·음 ↔ 한자, 서울 성문 이름까지 섞어서 출제합니다.</p></div><button type="button">시험 시작</button>';
      card.querySelector('button').addEventListener('click', openSetup);
      weak.insertAdjacentElement('beforebegin', card);
    }
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'hanja-test-dialog';
    dialog.id = 'hanjaTestDialog';
    dialog.innerHTML = '<div class="hanja-test-shell" id="hanjaTestShell"></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (event) => {
      if (session && !session.finished) {
        event.preventDefault();
        if (confirm('진행 중인 시험을 끝낼까요?')) closeTest();
      }
    });
    return dialog;
  }

  function openSetup() {
    ensureDialog();
    session = null;
    const count = allItems().length;
    $('#hanjaTestShell', dialog).innerHTML = `
      <div class="test-head"><div><p>시험 모드</p><h2>학교 학습지 한자</h2></div><button class="test-close" type="button" aria-label="닫기">×</button></div>
      <div class="test-setup">
        <div class="test-hero"><span class="test-hero-char">試</span><div><strong>${count}자에서 무작위 출제</strong><p>문제와 선택지 순서를 매번 섞습니다. 틀린 글자는 마지막에 따로 모아줍니다.</p></div></div>
        <fieldset><legend>문제 수</legend><div class="test-segments">
          <label><input type="radio" name="testCount" value="10" checked><span>10문제</span></label>
          <label><input type="radio" name="testCount" value="20"><span>20문제</span></label>
          <label><input type="radio" name="testCount" value="all"><span>전체</span></label>
        </div></fieldset>
        <fieldset><legend>출제 방식</legend><div class="test-checks">
          <label><input type="checkbox" name="typeReading" checked><span>한자 → 훈·음</span></label>
          <label><input type="checkbox" name="typeChar" checked><span>훈·음 → 한자</span></label>
          <label><input type="checkbox" name="typeGate" checked><span>성문 이름</span></label>
        </div></fieldset>
        <button class="test-primary" id="startHanjaTest" type="button">시험 시작</button>
      </div>`;
    $('.test-close', dialog).addEventListener('click', closeTest);
    $('#startHanjaTest', dialog).addEventListener('click', startTest);
    dialog.showModal();
  }

  function startTest() {
    const items = allItems();
    if (items.length < 4) return;
    const rawCount = $('input[name="testCount"]:checked', dialog)?.value || '10';
    const types = [];
    if ($('input[name="typeReading"]', dialog)?.checked) types.push('reading');
    if ($('input[name="typeChar"]', dialog)?.checked) types.push('char');
    if ($('input[name="typeGate"]', dialog)?.checked && termBank().length) types.push('term');
    if (!types.length) types.push('reading');
    const total = rawCount === 'all' ? items.length : Math.min(items.length, Number(rawCount));
    const itemPool = shuffle(items).slice(0, total);
    const questions = itemPool.map((item, i) => makeQuestion(item, types[i % types.length], items));
    // 성문 문제를 켠 경우 최소 한 문제는 넣습니다.
    if (types.includes('term') && questions.length && !questions.some((q) => q.type === 'term')) {
      questions[questions.length - 1] = makeTermQuestion(shuffle(termBank())[0]);
    }
    session = { questions, index:0, score:0, wrong:[], answers:[], finished:false, startedAt:Date.now() };
    renderQuestion();
  }

  function distractors(item, items, mapper) {
    const answer = mapper(item);
    const pool = shuffle(items.filter((x) => x.char !== item.char)).map(mapper).filter((value, i, arr) => value && value !== answer && arr.indexOf(value) === i);
    return shuffle([answer, ...pool.slice(0, 3)]);
  }

  function makeQuestion(item, type, items) {
    if (type === 'term') {
      const related = termBank().filter((term) => term.hanja.includes(item.char));
      if (related.length) return makeTermQuestion(shuffle(related)[0]);
      type = 'reading';
    }
    if (type === 'char') {
      return {
        type:'char', item,
        prompt:`${item.hun} ${item.eum}`,
        sub:'알맞은 한자를 고르세요.',
        answer:item.char,
        options:distractors(item, items, (x) => x.char)
      };
    }
    const answer = `${item.hun} ${item.eum}`;
    return {
      type:'reading', item,
      prompt:item.char,
      sub:'이 한자의 훈과 음은?',
      answer,
      options:distractors(item, items, (x) => `${x.hun} ${x.eum}`)
    };
  }

  function makeTermQuestion(term) {
    const bank = termBank();
    const reverse = Math.random() < .5;
    if (reverse) {
      const options = shuffle([term.hanja, ...shuffle(bank.filter((x) => x.hanja !== term.hanja)).slice(0,3).map((x) => x.hanja)]);
      return { type:'term', term, prompt:term.hangul, sub:'알맞은 한자 표기를 고르세요.', answer:term.hanja, options };
    }
    const options = shuffle([term.reading, ...shuffle(bank.filter((x) => x.reading !== term.reading)).slice(0,3).map((x) => x.reading)]);
    return { type:'term', term, prompt:term.hanja, sub:'이 성문 이름은?', answer:term.reading, options };
  }

  function renderQuestion() {
    const q = session.questions[session.index];
    const progress = `${session.index + 1} / ${session.questions.length}`;
    const hanjaPrompt = /[\u3400-\u9fff\uf900-\ufaff]/u.test(q.prompt);
    $('#hanjaTestShell', dialog).innerHTML = `
      <div class="test-head compact"><div><p>시험 모드</p><h2>${progress}</h2></div><button class="test-close" type="button" aria-label="시험 끝내기">×</button></div>
      <div class="test-progress"><span style="width:${((session.index) / session.questions.length) * 100}%"></span></div>
      <div class="test-question">
        <span class="test-type">${q.type === 'term' ? '성문' : q.type === 'char' ? '훈·음 → 한자' : '한자 → 훈·음'}</span>
        <div class="test-prompt ${hanjaPrompt ? 'is-hanja' : ''}">${q.prompt}</div>
        <p>${q.sub}</p>
        <div class="test-options">${q.options.map((option, i) => `<button type="button" data-option="${i}" class="${/[\u3400-\u9fff\uf900-\ufaff]/u.test(option) ? 'is-hanja' : ''}">${option}</button>`).join('')}</div>
        <div class="test-feedback" id="testFeedback" aria-live="polite"></div>
      </div>`;
    $('.test-close', dialog).addEventListener('click', () => { if (confirm('진행 중인 시험을 끝낼까요?')) closeTest(); });
    dialog.querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', () => answerQuestion(button, q)));
  }

  function answerQuestion(button, q) {
    if (button.closest('.test-options')?.dataset.locked === 'true') return;
    button.closest('.test-options').dataset.locked = 'true';
    const value = q.options[Number(button.dataset.option)];
    const correct = value === q.answer;
    if (correct) session.score += 1;
    else session.wrong.push(q);
    session.answers.push({ type:q.type, prompt:q.prompt, answer:q.answer, selected:value, correct });
    dialog.querySelectorAll('[data-option]').forEach((choice) => {
      const option = q.options[Number(choice.dataset.option)];
      choice.classList.toggle('is-correct', option === q.answer);
      choice.classList.toggle('is-wrong', choice === button && !correct);
      choice.disabled = true;
    });
    const feedback = $('#testFeedback', dialog);
    feedback.innerHTML = correct ? '<strong>정답</strong>' : `<strong>오답</strong><span>정답: ${q.answer}</span>`;
    window.setTimeout(() => {
      session.index += 1;
      if (session.index >= session.questions.length) finishTest(); else renderQuestion();
    }, 650);
  }

  function finishTest() {
    session.finished = true;
    const percent = Math.round((session.score / session.questions.length) * 100);
    const wrongUnique = [];
    const seen = new Set();
    for (const q of session.wrong) {
      const key = q.item?.char || q.term?.hanja || q.prompt;
      if (seen.has(key)) continue;
      seen.add(key); wrongUnique.push(q);
    }
    saveHistory(percent);
    $('#hanjaTestShell', dialog).innerHTML = `
      <div class="test-head"><div><p>시험 결과</p><h2>${percent}점</h2></div><button class="test-close" type="button">×</button></div>
      <div class="test-result">
        <div class="test-score-ring"><strong>${session.score}</strong><span>/ ${session.questions.length}</span></div>
        <h3>${percent >= 90 ? '거의 다 잡았습니다.' : percent >= 70 ? '조금만 더 다듬으면 됩니다.' : '틀린 글자부터 다시 보면 됩니다.'}</h3>
        <p>맞은 문제 ${session.score}개 · 틀린 문제 ${session.questions.length - session.score}개</p>
        <div class="test-wrong-list">${wrongUnique.length ? wrongUnique.map((q) => {
          const ch = q.item?.char || q.term?.hanja || q.answer;
          const label = q.item ? `${q.item.hun} ${q.item.eum}` : q.term?.reading || q.answer;
          return `<button type="button" data-review-char="${q.item?.char || ''}"><span>${ch}</span><small>${label}</small></button>`;
        }).join('') : '<div class="test-perfect">틀린 문제가 없습니다.</div>'}</div>
        <div class="test-result-actions"><button type="button" id="retryHanjaTest">다시 시험</button><button type="button" class="primary" id="closeHanjaTest">학습으로 돌아가기</button></div>
      </div>`;
    $('.test-close', dialog).addEventListener('click', closeTest);
    $('#retryHanjaTest', dialog).addEventListener('click', openSetup);
    $('#closeHanjaTest', dialog).addEventListener('click', closeTest);
    dialog.querySelectorAll('[data-review-char]').forEach((button) => button.addEventListener('click', () => {
      const char = button.dataset.reviewChar;
      if (!char) return;
      const target = hanjaSet.findIndex((item) => item.char === char);
      if (target >= 0) {
        try { index = target; localStorage.setItem('pincon-hanja-index', String(index)); render(); } catch (_) {}
      }
      closeTest();
    }));
  }

  function saveHistory(percent) {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      history.unshift({ at:Date.now(), score:session.score, total:session.questions.length, percent, wrong:session.wrong.map((q) => q.item?.char || q.term?.hanja || q.prompt).slice(0,30) });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0,12)));
    } catch (_) {}
  }

  function closeTest() {
    dialog?.close();
    session = null;
  }

  function init() { injectTrigger(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
  document.addEventListener('pincon:hanja-set-updated', injectTrigger);
})();
