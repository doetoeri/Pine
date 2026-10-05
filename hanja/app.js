const hanjaSet = [
  { char:'體', hun:'몸', eum:'체', strokes:23, parts:[['骨','뼈 골','몸·뼈의 뜻'],['豊','풍성할 풍','소리를 보태는 부분']], structure:'骨이 뜻을, 豊이 소리를 보태는 형성자로 정리할 수 있습니다.', origin:'體는 몸이나 신체를 뜻합니다. 형태를 볼 때는 骨을 의미 요소로, 豊을 소리 요소로 묶어 보면 복잡한 글자가 두 덩어리로 정리됩니다.', memory:'骨(뼈) + 豊(소리) → 몸 전체를 가리키는 體', usage:[['身體','신체','몸 신 · 몸 체'],['體育','체육','몸 체 · 기를 육'],['體力','체력','몸 체 · 힘 력']] },
  { char:'智', hun:'지혜', eum:'지', strokes:12, parts:[['知','알 지','알다'],['日','날 일','아래의 日']], structure:'知 아래에 日이 놓인 모양으로 덩어리를 나누어 기억합니다.', origin:'智는 ‘지혜, 슬기’를 뜻합니다. 시험용 형태 기억에서는 知와 日의 위치 관계를 먼저 확실히 잡는 것이 좋습니다.', memory:'知를 먼저 찾고, 아래에 日을 붙여 智', usage:[['智慧','지혜','지혜 지 · 슬기 혜'],['明智','명지','밝을 명 · 지혜 지'],['智力','지력','지혜 지 · 힘 력']] },
  { char:'仁', hun:'어질', eum:'인', strokes:4, parts:[['亻','사람 인','사람'],['二','두 이','둘']], structure:'사람을 나타내는 亻과 二가 나란히 놓입니다.', origin:'仁은 사람 사이에서 지켜야 할 어짐과 사랑을 뜻하는 글자로 익힙니다.', memory:'사람(亻)과 사람 사이(二)의 마음 → 仁', usage:[['仁義','인의','어질 인 · 옳을 의'],['仁愛','인애','어질 인 · 사랑 애'],['仁德','인덕','어질 인 · 덕 덕']] },
  { char:'義', hun:'옳을', eum:'의', strokes:13, parts:[['羊','양 양','위쪽'],['我','나 아','아래쪽']], structure:'위의 羊과 아래의 我, 두 덩어리로 나누어 봅니다.', origin:'義는 ‘옳다, 마땅하다’의 뜻으로 쓰입니다. 복잡해 보여도 羊 / 我의 위아래 구조를 먼저 잡으면 기억하기 쉽습니다.', memory:'羊 위, 我 아래. 뜻은 ‘옳을 의’.', usage:[['正義','정의','바를 정 · 옳을 의'],['義理','의리','옳을 의 · 다스릴 리'],['仁義','인의','어질 인 · 옳을 의']] },
  { char:'禮', hun:'예도', eum:'례', strokes:17, parts:[['礻','보일 시 변','제사·예'],['豊','풍성할 풍','오른쪽']], structure:'왼쪽 礻과 오른쪽 豊으로 나누어 구조를 잡습니다.', origin:'禮는 예절과 의례를 뜻합니다. 왼쪽의 礻을 먼저 찾으면 복잡한 오른쪽과 쉽게 분리됩니다.', memory:'礻 + 豊 → 예도 례', usage:[['禮節','예절','예도 례 · 마디 절'],['禮儀','예의','예도 례 · 거동 의'],['失禮','실례','잃을 실 · 예도 례']] },
  { char:'信', hun:'믿을', eum:'신', strokes:9, parts:[['亻','사람 인','사람'],['言','말씀 언','말']], structure:'亻과 言이 좌우로 결합합니다.', origin:'信은 사람이 한 말을 지킨다는 기억 고리로 ‘믿음’의 뜻을 연결하기 좋습니다.', memory:'사람(亻)의 말(言)을 믿는다 → 信', usage:[['信用','신용','믿을 신 · 쓸 용'],['信念','신념','믿을 신 · 생각 념'],['通信','통신','통할 통 · 믿을 신']] },
  { char:'東', hun:'동녘', eum:'동', strokes:8, parts:[['東','동녘 동','단일자']], structure:'분해보다 전체 윤곽을 하나의 글자 모양으로 기억하는 편이 안전합니다.', origin:'東은 동쪽을 나타내는 기본 방향 한자입니다. 日+木 같은 민간식 풀이를 실제 자원과 섞지 않고, 형태 기억과 자원 설명을 따로 둡니다.', memory:'방향 묶음 東·西·南·北으로 함께 인출', usage:[['東方','동방','동녘 동 · 모 방'],['東門','동문','동녘 동 · 문 문'],['東西','동서','동녘 동 · 서녘 서']] },
  { char:'西', hun:'서녘', eum:'서', strokes:6, parts:[['西','서녘 서','단일자']], structure:'윗부분 一과 안쪽 모양의 위치를 통째로 관찰합니다.', origin:'西는 서쪽을 나타내는 기본 방향 한자입니다.', memory:'東과 짝으로 西를 바로 떠올리기', usage:[['西方','서방','서녘 서 · 모 방'],['西門','서문','서녘 서 · 문 문'],['東西','동서','동녘 동 · 서녘 서']] },
  { char:'南', hun:'남녘', eum:'남', strokes:9, parts:[['南','남녘 남','단일자']], structure:'바깥 윤곽과 안쪽 모양을 덩어리로 봅니다.', origin:'南은 남쪽을 나타내는 기본 방향 한자입니다.', memory:'東·西·南·北 네 방향 가운데 남쪽', usage:[['南方','남방','남녘 남 · 모 방'],['南門','남문','남녘 남 · 문 문'],['南北','남북','남녘 남 · 북녘 북']] },
  { char:'北', hun:'북녘', eum:'북', strokes:5, parts:[['北','북녘 북','등진 두 사람 모양']], structure:'서로 등진 듯한 좌우 획을 비교해 전체 형태를 잡습니다.', origin:'北은 고대 문자에서 서로 등을 진 두 사람의 모습과 연결해 설명되는 글자이며, ‘북쪽’의 뜻으로 쓰입니다.', memory:'南과 반대 방향 → 北', usage:[['北方','북방','북녘 북 · 모 방'],['北門','북문','북녘 북 · 문 문'],['南北','남북','남녘 남 · 북녘 북']] },
  { char:'父', hun:'아비', eum:'부', strokes:4, parts:[['父','아비 부','단일자']], structure:'네 획의 교차 위치를 통째로 익힙니다.', origin:'父는 아버지를 뜻하는 기본 가족 한자입니다.', memory:'父母를 한 묶음으로 인출', usage:[['父母','부모','아비 부 · 어미 모'],['父子','부자','아비 부 · 아들 자'],['祖父','조부','할아비 조 · 아비 부']] },
  { char:'母', hun:'어미', eum:'모', strokes:5, parts:[['母','어미 모','단일자']], structure:'가운데 점 두 개와 바깥 획의 위치를 함께 기억합니다.', origin:'母는 어머니를 뜻하는 기본 가족 한자입니다.', memory:'父母에서 父의 짝 → 母', usage:[['父母','부모','아비 부 · 어미 모'],['母子','모자','어미 모 · 아들 자'],['祖母','조모','할미 조 · 어미 모']] },
  { char:'兄', hun:'형', eum:'형', strokes:5, parts:[['口','입 구','위쪽'],['儿','어진 사람 인','아래쪽']], structure:'위의 口와 아래의 儿처럼 보이는 두 덩어리로 봅니다.', origin:'兄은 형이나 손위 남자 형제를 뜻합니다.', memory:'兄弟를 한 쌍으로 기억', usage:[['兄弟','형제','형 형 · 아우 제'],['兄長','형장','형 형 · 어른 장'],['長兄','장형','맏 장 · 형 형']] },
  { char:'弟', hun:'아우', eum:'제', strokes:7, parts:[['弟','아우 제','전체형']], structure:'위쪽 점·가로획과 가운데 활 모양, 아래 삐침을 순서대로 묶어 봅니다.', origin:'弟는 아우나 손아래 형제를 뜻합니다.', memory:'兄弟에서 兄 다음 글자 → 弟', usage:[['兄弟','형제','형 형 · 아우 제'],['弟子','제자','아우 제 · 아들 자'],['子弟','자제','아들 자 · 아우 제']] },
  { char:'婦', hun:'며느리', eum:'부', strokes:11, parts:[['女','계집 녀','여자'],['帚','비 추','오른쪽']], structure:'왼쪽 女와 오른쪽 帚의 좌우 구조입니다.', origin:'婦는 여성을 나타내는 女와 帚가 결합한 형태로 전해지며, 아내·며느리와 관련된 뜻으로 쓰입니다.', memory:'女 + 帚 → 婦', usage:[['夫婦','부부','지아비 부 · 며느리 부'],['婦人','부인','며느리 부 · 사람 인'],['主婦','주부','주인 주 · 며느리 부']] },
  { char:'夫', hun:'지아비', eum:'부', strokes:4, parts:[['大','큰 대','기본 몸'],['一','한 일','위 획']], structure:'大 위에 가로획 하나가 더 있다고 비교하면 편합니다.', origin:'夫는 성인 남자, 남편 등의 뜻으로 쓰입니다.', memory:'大와 비교해 위 가로획 하나를 확인', usage:[['夫婦','부부','지아비 부 · 며느리 부'],['夫人','부인','지아비 부 · 사람 인'],['丈夫','장부','어른 장 · 지아비 부']] },
  { char:'結', hun:'맺을', eum:'결', strokes:12, parts:[['糹','실 사 변','실'],['吉','길할 길','오른쪽']], structure:'왼쪽 糹와 오른쪽 吉의 좌우 구조입니다.', origin:'結은 실을 뜻하는 糹가 의미를, 吉이 소리를 보태는 형성자로 설명됩니다. ‘묶다·맺다’의 뜻으로 이어집니다.', memory:'실(糹)로 묶어 맺는다 → 結', usage:[['結婚','결혼','맺을 결 · 혼인할 혼'],['結果','결과','맺을 결 · 열매 과'],['結論','결론','맺을 결 · 논할 론']] },
  { char:'婚', hun:'혼인할', eum:'혼', strokes:11, parts:[['女','계집 녀','여자'],['昏','어두울 혼','소리']], structure:'왼쪽 女와 오른쪽 昏으로 분해합니다.', origin:'婚은 女가 뜻을, 昏이 소리를 보태는 형성자로 설명됩니다. 혼인·결혼과 관련된 뜻으로 쓰입니다.', memory:'女 + 昏 → 婚', usage:[['結婚','결혼','맺을 결 · 혼인할 혼'],['婚姻','혼인','혼인할 혼 · 혼인 인'],['新婚','신혼','새 신 · 혼인할 혼']] }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  mainChar: $('#mainChar'), prevChar: $('#prevChar'), nextChar: $('#nextChar'),
  hunText: $('#hunText'), eumText: $('#eumText'), hunTag: $('#hunTag'), eumTag: $('#eumTag'), strokeCount: $('#strokeCount'),
  progressText: $('#progressText'), progressBar: $('#progressBar'), detailPanel: $('#detailPanel'),
  lens: $('#lens'), strokeLayer: $('#strokeLayer'), weakList: $('#weakList'),
  writeDialog: $('#writeDialog'), writingGuide: $('#writingGuide'), writingBoard: $('#writingBoard'), writingCanvas: $('#writingCanvas'), selfCheck: $('#selfCheck'),
  searchDialog: $('#searchDialog'), searchInput: $('#searchInput'), searchResults: $('#searchResults')
};

let index = Number(localStorage.getItem('pincon-hanja-index') || 0);
if (!Number.isFinite(index) || index < 0 || index >= hanjaSet.length) index = 0;
let mode = 'structure';
let strokeWriter = null;
let swipeStartX = null;
let swipeStartY = null;
let drawing = false;
let lastPoint = null;
const mastery = JSON.parse(localStorage.getItem('pincon-hanja-mastery') || '{}');

function current() { return hanjaSet[index]; }
function circular(i) { return (i + hanjaSet.length) % hanjaSet.length; }

function render(direction = 0) {
  const item = current();
  const prev = hanjaSet[circular(index - 1)];
  const next = hanjaSet[circular(index + 1)];

  els.mainChar.style.setProperty('--enter-x', direction > 0 ? '34px' : direction < 0 ? '-34px' : '0px');
  els.mainChar.classList.remove('is-entering');
  void els.mainChar.offsetWidth;
  els.mainChar.textContent = item.char;
  els.mainChar.classList.add('is-entering');
  els.prevChar.textContent = prev.char;
  els.nextChar.textContent = next.char;
  els.hunText.textContent = item.hun;
  els.eumText.textContent = item.eum;
  els.hunTag.textContent = item.hun;
  els.eumTag.textContent = item.eum;
  els.strokeCount.textContent = item.strokes;
  els.progressText.textContent = `${index + 1} / ${hanjaSet.length}`;
  els.progressBar.style.width = `${((index + 1) / hanjaSet.length) * 100}%`;
  els.lens.setAttribute('aria-label', `${item.char}, ${item.hun} ${item.eum}`);
  localStorage.setItem('pincon-hanja-index', String(index));
  hideStrokeLayer();
  renderMode();
  renderWeakList();
}

function changeChar(delta) {
  els.mainChar.style.setProperty('--leave-x', delta > 0 ? '-34px' : '34px');
  els.mainChar.classList.add('is-leaving');
  setTimeout(() => {
    index = circular(index + delta);
    els.mainChar.classList.remove('is-leaving');
    render(delta);
  }, 115);
}

function modeTitle(title, subtitle) {
  return `<div class="detail-head"><h2>${title}</h2><p>${subtitle}</p></div>`;
}

function renderMode() {
  const item = current();
  $$('.mode-tab').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (mode === 'structure') {
    const cards = item.parts.map(([char, label, note]) => `
      <div class="part-card"><span class="hanja">${char}</span><strong>${label}</strong><small>${note}</small></div>`).join('<span class="flow-symbol">+</span>');
    els.detailPanel.innerHTML = `${modeTitle('한자의 구조', item.structure)}
      <div class="structure-flow">${cards}<span class="flow-symbol">→</span><div class="result-card"><span class="hanja">${item.char}</span><strong>${item.hun} ${item.eum}</strong><small>전체 글자</small></div></div>`;
  } else if (mode === 'origin') {
    els.detailPanel.innerHTML = `${modeTitle('유래와 기억 고리', '자원 설명과 암기용 기억법을 구분해 보여줍니다.')}
      <p class="origin-copy">${item.origin}</p><div class="origin-callout"><strong>기억 고리</strong> · ${item.memory}</div>`;
  } else if (mode === 'usage') {
    els.detailPanel.innerHTML = `${modeTitle('실제 쓰임', '글자 하나를 단어 속에서 다시 만납니다.')}
      <div class="usage-grid">${item.usage.map(([word, reading, note]) => `<div class="usage-card"><span class="hanja">${word}</span><div><strong>${reading}</strong><small>${note}</small></div></div>`).join('')}</div>`;
  } else {
    els.detailPanel.innerHTML = `${modeTitle('획순', `${item.hun} ${item.eum} · ${item.strokes}획`)}
      <div class="stroke-info"><div class="stroke-preview"><span class="hanja">${item.char}</span></div><div class="stroke-actions"><h3>렌즈 안에서 획순 보기</h3><p>필요할 때만 획순 데이터를 불러옵니다. 평소 화면은 가볍게 유지합니다.</p><button type="button" class="mini-button" id="playStrokes">획순 재생</button></div></div>`;
    $('#playStrokes')?.addEventListener('click', playStrokeAnimation);
  }
}

function playStrokeAnimation() {
  const item = current();
  if (!window.HanziWriter) {
    els.strokeLayer.classList.add('is-visible');
    els.strokeLayer.innerHTML = `<div style="display:grid;place-items:center;text-align:center;color:#777;font-size:13px;padding:22px">획순 모듈을 불러오지 못했습니다.<br>네트워크를 확인해주세요.</div>`;
    return;
  }
  els.strokeLayer.innerHTML = '<div id="strokeTarget"></div>';
  els.strokeLayer.classList.add('is-visible');
  strokeWriter = HanziWriter.create('strokeTarget', item.char, {
    width: Math.max(190, els.strokeLayer.clientWidth),
    height: Math.max(190, els.strokeLayer.clientHeight),
    padding: 14,
    strokeAnimationSpeed: 1.2,
    delayBetweenStrokes: 180,
    showOutline: true,
    strokeColor: '#1d1d1a',
    outlineColor: '#d8d6cf',
    radicalColor: '#bd332e'
  });
  strokeWriter.animateCharacter();
}

function hideStrokeLayer() {
  els.strokeLayer.classList.remove('is-visible');
  els.strokeLayer.innerHTML = '';
  strokeWriter = null;
}

function renderWeakList() {
  const defaultWeak = ['禮','婦','義','體'];
  const gradedWeak = Object.entries(mastery).filter(([, grade]) => grade !== 'good').map(([char]) => char);
  const chars = [...new Set([...gradedWeak, ...defaultWeak])].slice(0, 4);
  els.weakList.innerHTML = chars.map(char => {
    const item = hanjaSet.find(h => h.char === char) || hanjaSet[0];
    return `<button type="button" class="weak-card" data-char="${item.char}"><span class="hanja">${item.char}</span><small>${item.hun} ${item.eum}</small></button>`;
  }).join('');
  $$('.weak-card').forEach(btn => btn.addEventListener('click', () => jumpTo(btn.dataset.char)));
}

function jumpTo(char) {
  const nextIndex = hanjaSet.findIndex(item => item.char === char);
  if (nextIndex < 0) return;
  const delta = nextIndex >= index ? 1 : -1;
  index = nextIndex;
  render(delta);
  window.scrollTo({ top: 68, behavior: 'smooth' });
}

function openWrite() {
  const item = current();
  $('#writeHun').textContent = item.hun;
  $('#writeEum').textContent = item.eum;
  els.writingGuide.textContent = item.char;
  els.writingBoard.classList.remove('show-guide', 'reveal');
  els.selfCheck.hidden = true;
  els.writeDialog.showModal();
  requestAnimationFrame(resizeCanvas);
}

function resizeCanvas() {
  const canvas = els.writingCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, rect.width * .016);
  ctx.strokeStyle = '#171816';
}

function canvasPoint(event) {
  const rect = els.writingCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function startDraw(event) { drawing = true; lastPoint = canvasPoint(event); els.writingCanvas.setPointerCapture?.(event.pointerId); }
function draw(event) {
  if (!drawing || !lastPoint) return;
  const point = canvasPoint(event);
  const ctx = els.writingCanvas.getContext('2d');
  ctx.beginPath(); ctx.moveTo(lastPoint.x, lastPoint.y); ctx.lineTo(point.x, point.y); ctx.stroke();
  lastPoint = point;
}
function endDraw() { drawing = false; lastPoint = null; }
function clearDrawing() { const ctx = els.writingCanvas.getContext('2d'); ctx.clearRect(0, 0, els.writingCanvas.clientWidth, els.writingCanvas.clientHeight); els.writingBoard.classList.remove('reveal'); els.selfCheck.hidden = true; }

function openSearch() {
  els.searchDialog.showModal();
  els.searchInput.value = '';
  renderSearch('');
  setTimeout(() => els.searchInput.focus(), 30);
}
function renderSearch(query) {
  const q = query.trim().toLowerCase();
  const results = hanjaSet.filter(item => !q || [item.char,item.hun,item.eum,...item.usage.flat()].some(value => String(value).toLowerCase().includes(q))).slice(0, 10);
  els.searchResults.innerHTML = results.map(item => `<button type="button" class="search-result" data-char="${item.char}"><span class="hanja">${item.char}</span><span><strong>${item.hun} ${item.eum}</strong><small>${item.usage.map(u => u[0]).join(' · ')}</small></span></button>`).join('');
  $$('.search-result').forEach(btn => btn.addEventListener('click', () => { els.searchDialog.close(); jumpTo(btn.dataset.char); }));
}

$('#prevButton').addEventListener('click', () => changeChar(-1));
$('#nextButton').addEventListener('click', () => changeChar(1));
$('#prevPreview').addEventListener('click', () => changeChar(-1));
$('#nextPreview').addEventListener('click', () => changeChar(1));
$('#writeButton').addEventListener('click', openWrite);
$('#closeWrite').addEventListener('click', () => els.writeDialog.close());
$('#clearCanvas').addEventListener('click', clearDrawing);
$('#toggleGuide').addEventListener('click', () => els.writingBoard.classList.toggle('show-guide'));
$('#revealAnswer').addEventListener('click', () => { els.writingBoard.classList.add('reveal'); els.selfCheck.hidden = false; });
$('#searchButton').addEventListener('click', openSearch);
els.searchInput.addEventListener('input', event => renderSearch(event.target.value));

$$('.mode-tab').forEach(btn => btn.addEventListener('click', () => { mode = btn.dataset.mode; hideStrokeLayer(); renderMode(); }));
$$('[data-grade]').forEach(btn => btn.addEventListener('click', () => {
  mastery[current().char] = btn.dataset.grade;
  localStorage.setItem('pincon-hanja-mastery', JSON.stringify(mastery));
  renderWeakList();
  els.writeDialog.close();
  if (btn.dataset.grade === 'good') changeChar(1);
}));

els.lens.addEventListener('pointerdown', event => { swipeStartX = event.clientX; swipeStartY = event.clientY; });
els.lens.addEventListener('pointerup', event => {
  if (swipeStartX == null) return;
  const dx = event.clientX - swipeStartX;
  const dy = event.clientY - swipeStartY;
  swipeStartX = swipeStartY = null;
  if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.15) changeChar(dx < 0 ? 1 : -1);
});
els.lens.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') { event.preventDefault(); changeChar(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); changeChar(1); }
});

els.writingCanvas.addEventListener('pointerdown', startDraw);
els.writingCanvas.addEventListener('pointermove', draw);
els.writingCanvas.addEventListener('pointerup', endDraw);
els.writingCanvas.addEventListener('pointercancel', endDraw);
window.addEventListener('resize', () => { if (els.writeDialog.open) resizeCanvas(); });

document.addEventListener('keydown', event => {
  if (els.writeDialog.open || els.searchDialog.open) return;
  if (event.key === 'ArrowLeft') changeChar(-1);
  else if (event.key === 'ArrowRight') changeChar(1);
  else if (event.key === '/') { event.preventDefault(); openSearch(); }
});

$$('[data-view]').forEach(btn => btn.addEventListener('click', () => {
  const view = btn.dataset.view;
  if (view === 'dictionary') openSearch();
  else if (view === 'record') alert('학습 기록 화면은 다음 프로토타입 단계에서 연결합니다.');
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}));

render();
