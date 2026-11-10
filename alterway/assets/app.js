(() => {
  'use strict';

  const data = window.ALTERWAY_DATA;
  const study = window.ALTERWAY_STUDY;
  const engine = createAlterwayEngine();
  const config = engine.defaults(data);
  const line = config.routes.find((route) => route.id === 'B:optimal-math');
  const stations = engine.stations(data, config);
  const presenting = document.body.dataset.mode === 'present';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const number = (value, digits = 0) => value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const minutes = (seconds) => `${number(seconds / 60, 1)}분`;
  const roundedDuration = (seconds) => {
    const rounded = Math.round(Math.abs(seconds));
    return [Math.floor(rounded / 60) ? `${Math.floor(rounded / 60)}분` : '', rounded % 60 ? `${rounded % 60}초` : ''].filter(Boolean).join(' ') || '0초';
  };
  const clamp = (value) => Math.min(1, Math.max(0, value));
  const ease = (value) => 1 - (1 - clamp(value)) ** 2;
  const preset = { moran: [study.demo.from, study.demo.to], gimpo: ['L9:4102', 'SUIN:1854'] };
  const selectedStudy = study.candidates.find((candidate) => candidate.id === line.id);
  const screenColors = ['#b44a19', '#7950a6', '#14736c', '#227fae', '#3358ad', '#9d5596'];
  const searchStages = ['후보 펼치기', '길이·비용 확인', '절감량 비교', '영분선 선택'];
  const sceneNames = ['탐구 질문', '최단시간', '후보 비교', '경로 변화', '연구 결과'];
  const duration = 6000;
  const matchVersion = study.dataSHA === window.ALTERWAY_DATA_SHA;

  let mode = presenting ? '0' : 'B';
  let period = 'peak', journeyPair = null, journeyResults = null;
  let stage = 0, searchStarted = null, searchPhase = -1, searchHold = null, searchFinished = false;
  let audience = { status: 'connecting', people: [], ownId: null };
  let playback = null, playbackSeconds = 3600;
  let lastFrame = 0;
  const sharedServices = engine.trainServices(data, config, 'B', 'peak').filter((service) => service.line === line.id);
  const forward = sharedServices.find((service) => service.direction === 'F');
  const reverse = sharedServices.find((service) => service.direction === 'R');
  const map = createAlterwayMap({
    data, engine, config, presenting,
    onStation: presenting ? null : openStation,
    onEmpty: presenting ? null : () => { byId('stationInfo').hidden = true; },
  });

  function visitorSlot(id) {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % 4;
  }

  function virtualTrain(slot, now) {
    if (reducedMotion.matches || !forward || !reverse) return { a: line.stops[Math.floor(slot * (line.stops.length - 1) / 3)] };
    const loop = forward.duration + reverse.duration;
    const phase = (now * .032 + slot * loop / 4) % loop;
    const service = phase < forward.duration ? forward : reverse;
    const elapsed = phase < forward.duration ? phase : phase - forward.duration;
    const segment = service.segments.find((_, index) => elapsed < (service.segments[index + 1]?.start ?? Infinity));
    return { a: segment.a, b: segment.b, fraction: clamp((elapsed - segment.start) / (segment.end - segment.start)), line: line.id };
  }

  function renderEffects(frameTime, force = false) {
    if (!force && frameTime - lastFrame < 34) return;
    lastFrame = frameTime;
    let layers = [];
    if (presenting && stage === 2 && (searchStarted !== null || searchHold !== null)) {
      const elapsed = searchHold ?? (reducedMotion.matches ? duration : Math.min(duration, frameTime - searchStarted));
      const settled = elapsed >= duration;
      if (settled !== searchFinished) {
        map.setBase({ mode: settled ? 'B' : '0', dim: true, focused: true });
      }
      searchFinished = settled;
      const candidateLayers = renderCandidateAnimation(elapsed);
      if (!settled) layers = candidateLayers;
    }
    const showLine = mode === 'B' || (presenting && stage === 2 && searchPhase === 3);
    const participants = audience.people;
    let riders = [], trains = [];
    if (playback) {
      const time = (playbackSeconds + (frameTime - playback.start) * .06) % 64800;
      trains = engine.trainPositions(playback.services, time);
      const hour = String(Math.floor(time / 3600) + 6).padStart(2, '0');
      const minute = String(Math.floor(time / 60) % 60).padStart(2, '0');
      if (byId('trainClock').value !== `${hour}:${minute}`) byId('trainClock').value = `${hour}:${minute}`;
    }
    if (participants.length) {
      if (showLine) {
        const seats = [0, 0, 0, 0];
        for (const id of participants) seats[visitorSlot(id)]++;
        const ownSlot = audience.ownId && participants.includes(audience.ownId) ? visitorSlot(audience.ownId) : -1;
        const now = Date.now();
        riders = seats.flatMap((count, slot) => {
          if (!count) return [];
          const position = virtualTrain(slot, now);
          const label = slot === ownSlot ? (count === 1 ? '나' : `${count}명 · 나 포함`) : `${count}명`;
          if (position.b) trains.push(position);
          return [{ ...position, label }];
        });
      } else {
        riders = [{ a: line.stops[0], label: `${participants.length}명 접속` }];
      }
    }
    map.setEffects({ candidates: layers, audience: riders, trains });
  }

  function animate(frameTime) {
    const movingSearch = presenting && stage === 2 && searchStarted !== null && searchHold === null && !searchFinished;
    const movingAudience = audience.people.length && !reducedMotion.matches && (mode === 'B' || (presenting && stage === 2 && searchPhase === 3));
    if (movingSearch || movingAudience || playback) renderEffects(frameTime);
    window.requestAnimationFrame(animate);
  }

  function showPresence(update) {
    audience = update;
    const output = byId('presenceStatus');
    const count = update.people.length;
    const labels = { local: '오프라인 시연', connecting: '접속 연결 중', waiting: '접속 연결 대기', unavailable: '접속 연동 필요' };
    const next = update.status === 'live' ? `접속 ${count === 150 ? '150+' : count}명` : labels[update.status];
    if (output.textContent !== next) output.textContent = next;
    output.dataset.connected = String(update.status === 'live');
    renderEffects(performance.now(), true);
  }

  function presentBase(nextMode, { focus = false, steps = [], pins = [] } = {}) {
    mode = nextMode;
    map.setBase({ mode, dim: presenting || mode === 'B', focused: focus, journey: steps, pins });
    renderEffects(performance.now(), true);
  }

  function setPublicMode(nextMode) {
    const steps = journeyResults?.[nextMode].steps ?? [];
    if (playback) playback.services = engine.trainServices(data, config, nextMode, period);
    presentBase(nextMode, { focus: Boolean(journeyPair), steps, pins: journeyPair ?? [] });
    document.querySelectorAll('[data-scenario]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.scenario === mode)));
    document.querySelectorAll('[data-result-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.resultMode === mode)));
    byId('mapCaption').textContent = mode === 'B' ? '영등포–야탑 · 24개 정차역' : '가상 신규 노선 추가 전';
  }

  function showPanel(open, focus = false) {
    byId('explorePanel').hidden = !open;
    byId('layout').classList.toggle('panel-open', open);
    byId('panelToggle').setAttribute('aria-expanded', String(open));
    byId('panelToggle').textContent = open ? '비교 접기' : '내 경로 비교';
    if (focus) (open ? byId('fromStation') : byId('panelToggle')).focus();
  }

  function stationLabel(id) {
    return `${stations[id].name} · ${map.name(stations[id].line)}`;
  }

  function openStation(id) {
    const card = byId('stationInfo');
    card.innerHTML = `<h2>${esc(stationLabel(id))}</h2><button type="button" data-station-field="fromStation">출발역 지정</button><button type="button" data-station-field="toStation">도착역 지정</button><button type="button" aria-label="역 정보 닫기" data-close>×</button>`;
    card.hidden = false;
    card.querySelectorAll('[data-station-field]').forEach((button) => button.addEventListener('click', () => {
      byId(button.dataset.stationField).value = stationLabel(id);
      showPanel(true);
      card.hidden = true;
      byId(button.dataset.stationField).focus();
    }));
    card.querySelector('[data-close]').addEventListener('click', () => { card.hidden = true; });
  }

  function initPublic() {
    const options = Object.keys(stations).filter((id) => !id.startsWith('PLAN:')).sort((a, b) => stationLabel(a).localeCompare(stationLabel(b), 'ko'));
    const exact = new Map(options.map((id) => [stationLabel(id), id]));
    byId('stationOptions').innerHTML = options.map((id) => `<option value="${esc(stationLabel(id))}"></option>`).join('');
    byId('stopList').innerHTML = line.stops.map((id) => `<li>${esc(stations[id].name)}</li>`).join('');
    byId('panelToggle').addEventListener('click', (event) => {
      const open = byId('explorePanel').hidden;
      showPanel(open, !open || event.detail === 0 || !window.matchMedia('(pointer: coarse)').matches);
    });
    byId('panelClose').addEventListener('click', () => showPanel(false, true));
    byId('zoomIn').addEventListener('click', () => map.zoom(1.35));
    byId('zoomOut').addEventListener('click', () => map.zoom(1 / 1.35));
    document.querySelectorAll('[data-scenario]').forEach((button) => button.addEventListener('click', () => setPublicMode(button.dataset.scenario)));
    byId('lineFocus').addEventListener('click', () => {
      journeyPair = null;
      journeyResults = null;
      byId('journeyResult').innerHTML = '';
      byId('stationInfo').hidden = true;
      setPublicMode('B');
      map.fit(line.stops);
    });
    byId('period').addEventListener('change', () => {
      period = byId('period').value;
      if (journeyPair) compare(...journeyPair);
      else if (playback) setPublicMode(mode);
    });
    byId('trainToggle').addEventListener('click', () => {
      const now = performance.now();
      if (playback) {
        playbackSeconds = (playbackSeconds + (now - playback.start) * .06) % 64800;
        playback = null;
      } else {
        playback = { start: now, services: engine.trainServices(data, config, mode, period) };
      }
      byId('trainToggle').textContent = playback ? '가상 열차 정지' : '가상 열차 재생';
      byId('trainToggle').setAttribute('aria-pressed', String(Boolean(playback)));
      renderEffects(now, true);
    });
    function parse(input) {
      const value = input.value.trim();
      if (exact.has(value)) return exact.get(value);
      const matches = options.filter((id) => stations[id].name === value);
      if (matches.length === 1) return matches[0];
      throw Error(matches.length ? `${value}에는 여러 노선이 있습니다. 역 이름과 노선명이 함께 적힌 항목을 골라 주세요.` : '검색 목록에서 출발역과 도착역을 골라 주세요.');
    }
    byId('journeyForm').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const a = parse(byId('fromStation')), b = parse(byId('toStation'));
        if (a === b) throw Error('서로 다른 출발역과 도착역을 골라 주세요.');
        compare(a, b);
      } catch (error) {
        byId('journeyResult').innerHTML = `<p class="form-error">${esc(error.message)}</p>`;
      }
    });
    document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => {
      const [a, b] = preset[button.dataset.preset];
      byId('fromStation').value = stationLabel(a);
      byId('toStation').value = stationLabel(b);
      compare(a, b);
    }));
    setPublicMode('B');
    map.fit(line.stops);
  }

  function compare(a, b) {
    const output = byId('journeyResult');
    journeyPair = [a, b];
    journeyResults = Object.fromEntries(['0', 'B'].map((key) => [key, engine.journey(data, config, key, a, b, period)]));
    const original = journeyResults['0'], changed = journeyResults.B;
    const comparable = Number.isFinite(original.seconds) && Number.isFinite(changed.seconds);
    const delta = comparable ? original.seconds - changed.seconds : null;
    const difference = !comparable ? '양쪽 경로의 시간을 모두 계산할 수 있는 구간에서 차이를 표시합니다.'
      : Math.abs(delta) < .5 ? '이 구간의 모형 이동시간은 같습니다.'
      : `영분선 추가 시 ${roundedDuration(delta)} ${delta > 0 ? '단축' : '증가'}`;
    const display = (key, label, result) => Number.isFinite(result.seconds)
      ? `<button type="button" data-result-mode="${key}" aria-pressed="${key === mode}"><small>${label}</small><strong>${minutes(result.seconds)}</strong><small>환승 ${number(result.transfers)}회</small></button>`
      : `<button type="button" data-result-mode="${key}" aria-pressed="${key === mode}"><small>${label}</small><span>연결 자료 부족</span></button>`;
    const timeRows = [['주행·정차', 'ride'], ['대기', 'wait'], ['환승 보행', 'walk']].map(([label, key]) =>
      `<tr><th scope="row">${label}</th><td>${Number.isFinite(original[key]) ? minutes(original[key]) : '—'}</td><td>${Number.isFinite(changed[key]) ? minutes(changed[key]) : '—'}</td></tr>`).join('');
    output.innerHTML = `<h2 class="result-heading">${esc(stations[a].name)} → ${esc(stations[b].name)}</h2><p class="delta">${difference}</p><div class="result-grid">${display('0', '기존망', original)}${display('B', '영분선 추가', changed)}</div><details class="details"><summary>계산 보기</summary><table><thead><tr><th scope="col">시간 구성</th><th scope="col">기존망</th><th scope="col">영분선 추가</th></tr></thead><tbody>${timeRows}</tbody></table><p>${engine.PERIODS[period].label} 가상 배차를 적용한 최단시간입니다.</p></details>`;
    output.querySelectorAll('[data-result-mode]').forEach((button) => button.addEventListener('click', () => setPublicMode(button.dataset.resultMode)));
    setPublicMode('B');
    const allStops = Object.values(journeyResults).flatMap((result) => result.steps.flatMap((edge) => [edge.a, edge.b]));
    map.fit([...new Set([a, b, ...allStops])]);
  }

  function demoJourney(key) {
    return study.demo.journeys[key];
  }

  function story(index) {
    const old = demoJourney('0'), next = demoJourney('B');
    const saving = selectedStudy.saving;
    const secondDifference = (saving / study.population) * 60;
    if (index === 0) return `<span class="eyebrow">01 / 05 · 탐구 질문</span><h1 id="storyTitle">새 노선 하나로 얼마나 빨라질까?</h1><p>같은 철도망에 가상 노선 하나를 추가해 이동시간 변화를 비교했습니다.</p><div class="story-metric"><strong>영등포 → 모란</strong><small>한 경로의 변화를 보고 전체 수요로 넓힙니다.</small></div>`;
    if (index === 1) return `<span class="eyebrow">02 / 05 · 그래프</span><h1 id="storyTitle">가장 빠른 경로를 찾기</h1><p>역과 승강장을 점으로, 이동 가능한 구간을 선으로 나타냅니다.</p><div class="equation">이동시간 = 주행·정차 + 대기 + 환승 보행</div><div class="story-metric"><strong>${minutes(old.seconds)}</strong><small>기존망 · 영등포 → 모란 · 출퇴근 가정</small></div>`;
    if (index === 2) return `<span class="eyebrow">03 / 05 · 경우의 수</span><h1 id="storyTitle">어느 연결이 더 많이 줄일까?</h1><p>영등포–야탑과 정차역 24개를 고정하고, 경유역을 바꾼 6개 안을 비교합니다.</p><div class="equation var" aria-label="절감량은 수요 곱하기 단축 시간의 합">S = ∑ q<sub>ij</sub> × Δt<sub>ij</sub></div><div class="candidate-head">${searchStages.map((label, index) => `<button type="button" data-search-phase="${index}" aria-pressed="false">${label}</button>`).join('')}</div><small class="note" id="candidateNote"></small><ol class="candidate-list" id="candidateList"></ol><button type="button" class="replay" id="replayCandidates">↻ 후보 비교 다시 보기</button>`;
    if (index === 3) return `<span class="eyebrow">04 / 05 · 경로 비교</span><h1 id="storyTitle">영등포에서 모란까지</h1><div class="story-metric"><strong>${minutes(old.seconds)} → ${minutes(next.seconds)}</strong><small>환승 ${number(old.transfers)}회 → ${number(next.transfers)}회 · 출퇴근 가정</small></div><p>같은 출발·도착 쌍에서 약 ${roundedDuration(old.seconds - next.seconds)} 줄었습니다.</p><div class="path-toggle"><button type="button" data-path="0" aria-pressed="false">기존 경로</button><button type="button" data-path="B" aria-pressed="true">영분선 경로</button></div>`;
    return `<span class="eyebrow">05 / 05 · 전체 수요</span><h1 id="storyTitle">시간을 모두 더하면</h1><div class="story-metric"><strong>${number(saving / 60)}</strong><small>하루 절감량 · 승객·시간</small></div><div class="story-metric"><strong>${number(secondDifference, 1)}초</strong><small>모형의 이동 1건당 평균 절감</small></div><p>수요 가중 평균 ${number(study.baseMean, 3)}분 → ${number(selectedStudy.mean, 3)}분</p><small class="note">두 철도망에서 모두 계산 가능한 ${number(study.count)}개 출발·도착 쌍 · 2040 연구 모형</small>`;
  }

  function renderCandidateAnimation(elapsed) {
    const phase = elapsed < 1800 ? 0 : elapsed < 3150 ? 1 : elapsed < 4600 ? 2 : 3;
    if (phase !== searchPhase) {
      searchPhase = phase;
      document.querySelectorAll('[data-search-phase]').forEach((chip) => chip.setAttribute('aria-pressed', String(Number(chip.dataset.searchPhase) === phase)));
      byId('candidateNote').textContent = [
        '정차역 수를 맞춘 경유역 치환 사례', '30–45km · 가정 건설비 4.5조 원 이하',
        '같은 출발·도착 수요에서 합산한 승객·시간/일', '통과한 3개 안 중 모형 절감량 최대',
      ][phase];
      byId('candidateList').innerHTML = study.candidates.map((candidate, index) => {
        const winner = candidate.id === line.id;
        const label = winner && phase < 3 ? '기준 경유안' : candidate.name;
        let summary = `${number(candidate.length, 1)}km`;
        if (phase === 1) summary = `${number(candidate.cost / 1e12, 3)}조${candidate.feasible ? '' : ' · 초과'}`;
        if (phase >= 2) summary = candidate.feasible ? `${number(candidate.saving / 60)}시간` : '조건 초과';
        const state = phase >= 1 && !candidate.feasible ? 'filtered' : phase === 3 && winner ? 'winner' : '';
        const percent = phase >= 2 && candidate.feasible ? `${Math.round(candidate.saving / selectedStudy.saving * 100)}%` : '0%';
        return `<li style="--candidate-color:${screenColors[index]};--bar:${percent}" data-state="${state}"><span>${esc(label)}</span><small>${summary}</small></li>`;
      }).join('');
      byId('mapScene').textContent = phase === 3 ? '영분선 · 연구 채택안' : '경유역을 바꾼 여섯 가지 후보';
      byId('mapCaption').textContent = phase === 3 ? '24개 정차역 · 40.9km · 약 4.35조 원' : '종점·정차역 수 고정';
    }
    return study.candidates.map((candidate, index) => {
      const winner = candidate.id === line.id && phase === 3;
      const initialProgress = ease((elapsed - index * 100) / 1150);
      let alpha = .78;
      if (!candidate.feasible && phase >= 1) alpha *= 1 - ease((elapsed - 1800) / 950);
      if (candidate.id !== line.id && phase === 3) alpha *= 1 - ease((elapsed - 4600) / 600);
      return { ...candidate, winner, offset: winner ? 0 : (index - 2.5) * 4.2, alpha: winner ? 1 : alpha,
        color: winner ? '#d90070' : screenColors[index], filtered: !candidate.feasible && phase >= 1,
        progress: winner ? ease((elapsed - 4600) / 1150) : initialProgress };
    });
  }

  function startSearch() {
    if (searchFinished) map.setBase({ mode: '0', dim: true, focused: true });
    searchStarted = performance.now();
    searchPhase = -1;
    searchHold = null;
    searchFinished = false;
    byId('mapScene').textContent = '경유역을 바꾼 여섯 가지 후보';
    byId('mapCaption').textContent = '종점·정차역 수 고정';
    renderEffects(searchStarted, true);
  }

  function chooseDemoPath(key) {
    presentBase(key, { focus: true, steps: demoJourney(key).steps, pins: [study.demo.from, study.demo.to] });
    byId('mapScene').textContent = key === 'B' ? '영분선 추가 후 경로' : '기존 철도망 최단 경로';
    document.querySelectorAll('[data-path]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.path === key)));
  }

  function setScene(index) {
    stage = Math.max(0, Math.min(sceneNames.length - 1, index));
    searchStarted = null;
    searchPhase = -1;
    searchHold = null;
    searchFinished = false;
    byId('storyCard').innerHTML = matchVersion ? story(stage) : '<h1 id="storyTitle">연구 데이터 버전을 확인해 주세요.</h1>';
    byId('mapScene').textContent = ['수도권 기준망', '기존 철도망 최단 경로', '경유역을 바꾼 여섯 가지 후보', '영분선 추가 후 경로', '영분선 · 수요 가중 결과'][stage];
    byId('mapCaption').textContent = stage >= 3 ? '기준망과 영분선 추가 비교' : '영등포–야탑 가상 노선 연구';
    document.querySelectorAll('[data-scene]').forEach((button) => {
      if (+button.dataset.scene === stage) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    byId('prevScene').disabled = stage === 0;
    byId('nextScene').textContent = stage === sceneNames.length - 1 ? '처음으로 ↻' : '다음 →';
    const endpoints = [study.demo.from, study.demo.to];
    const points = ['0', 'B'].flatMap((key) => demoJourney(key).steps.flatMap((edge) => [edge.a, edge.b]));
    presentBase(stage >= 3 ? 'B' : '0', { focus: stage !== 0, pins: stage === 0 || stage === 1 ? endpoints : [], steps: stage === 1 ? demoJourney('0').steps : [] });
    if (stage === 0) map.fit();
    if (stage === 1 || stage === 3) map.fit([...new Set([...points, ...endpoints])]);
    if (stage === 2) map.fit([...new Set(study.candidates.flatMap((candidate) => candidate.stops))]);
    if (stage === 4) map.fit(line.stops);
    if (!matchVersion) return;
    if (stage === 2) {
      byId('replayCandidates').addEventListener('click', startSearch);
      document.querySelectorAll('[data-search-phase]').forEach((button) => button.addEventListener('click', () => {
        searchHold = [1700, 3000, 4300, duration][Number(button.dataset.searchPhase)];
        renderEffects(performance.now(), true);
      }));
      startSearch();
    }
    if (stage === 3) {
      document.querySelectorAll('[data-path]').forEach((button) => button.addEventListener('click', () => chooseDemoPath(button.dataset.path)));
      chooseDemoPath('B');
    }
  }

  function initPresentation() {
    const next = () => setScene((stage + 1) % sceneNames.length);
    async function fullScreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      } catch {
        byId('fullscreen').textContent = '브라우저 전체화면 사용';
      }
    }
    byId('sceneSteps').innerHTML = sceneNames.map((name, index) => `<button type="button" data-scene="${index}" aria-label="${index + 1}. ${name}" title="${name}">${index + 1}</button>`).join('');
    document.querySelectorAll('[data-scene]').forEach((button) => button.addEventListener('click', () => setScene(+button.dataset.scene)));
    byId('prevScene').addEventListener('click', () => setScene(stage - 1));
    byId('nextScene').addEventListener('click', next);
    byId('fullscreen').addEventListener('click', fullScreen);
    document.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || (event.key === ' ' && !event.target.closest('button, a'))) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') setScene(stage - 1);
        else next();
      }
      if (event.key.toLowerCase() === 'f') void fullScreen();
    });
    setScene(0);
  }

  if (location.protocol !== 'file:') byId('modeLink').href = presenting ? '/alterway' : '/alterway/p';
  byId('fitMap').addEventListener('click', () => map.fit());
  if (presenting) initPresentation();
  else initPublic();
  reducedMotion.addEventListener('change', () => renderEffects(performance.now(), true));
  connectAlterwayPresence({ viewer: !presenting, onChange: showPresence });
  window.requestAnimationFrame(animate);
})();
