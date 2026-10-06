(() => {
  if (typeof hanjaSet === 'undefined' || !Array.isArray(hanjaSet)) return;

  const eye = {
    char:'目', hun:'눈', eum:'목', strokes:5,
    parts:[['目','전체 자형','눈의 윤곽과 안쪽 획을 봅니다.']],
    structure:'눈의 윤곽을 세로로 세운 형태를 통째로 익힙니다.',
    origin:'사람의 눈 모양을 본뜬 상형자입니다. 가로로 그린 눈의 고대 자형이 세로 방향의 현재 모양으로 정리되었습니다.',
    memory:'目 · 눈 목. 눈의 윤곽과 안쪽 두 획을 함께 기억합니다.',
    usage:[['耳目','이목','귀 이 · 눈 목'],['目標','목표','눈 목 · 표 표']],
    originExtra:{
      type:'상형자', key:'눈 모양', era:'갑골문부터 확인',
      origin:'사람의 눈 모양을 본뜬 상형자입니다. 가로로 그린 눈의 고대 자형이 세로 방향의 현재 모양으로 정리되었습니다.',
      deep:'눈 자체를 뜻하는 기본 글자이며, 보다·목표·항목처럼 시선과 구분의 의미로도 넓어졌습니다.',
      caution:'日과 비슷해 보여도 내부 획의 수와 전체 비율이 다릅니다.'
    },
    schoolCore:true
  };
  if (!hanjaSet.some((item) => item.char === '目')) hanjaSet.push(eye);

  const labels = {
    '智':['지혜·슬기','지'],
    '夫':['남편·지아비','부'],
    '婦':['아내·며느리','부'],
    '弟':['순서·공손할·아우','제'],
    '體':['몸','체']
  };
  for (const item of hanjaSet) {
    const label = labels[item.char];
    if (label) { item.hun = label[0]; item.eum = label[1]; }
  }

  window.HANJA_SCHOOL_CORE_COUNT = hanjaSet.length;
  try {
    const setName = document.getElementById('setName');
    if (setName) setName.textContent = `학교 학습지 · ${hanjaSet.length}자`;
    if (typeof render === 'function') render();
  } catch (_) {}
  document.dispatchEvent(new CustomEvent('pincon:hanja-set-updated', { detail:{ count:hanjaSet.length } }));
})();
