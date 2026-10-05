(() => {
  const motion = window.LoreGlassMotion;
  const reduced = motion?.prefersReducedMotion?.() ?? false;

  const etymology = {
    '體': {
      type: '형성자', key: '骨 + 豊', era: '전서 이전부터 확인',
      origin: '體는 ‘몸, 신체’를 뜻하는 글자입니다. 전통 자서에서는 骨이 뜻을 나타내고 豊이 소리를 보태는 형성자로 풀이합니다. 그래서 복잡한 전체를 통째로 외우기보다 왼쪽의 뼈 골 계열과 오른쪽 豊을 먼저 분리하면 자형이 안정적으로 기억됩니다.',
      deep: '오늘날의 體는 ‘몸’뿐 아니라 사물의 짜임이나 형식이라는 뜻으로도 넓어졌습니다. 體育·體力처럼 몸과 직접 관계된 말, 文體·字體처럼 형식이나 모양을 가리키는 말이 같은 글자에서 갈라져 나옵니다.',
      caution: '豊의 현재 뜻만으로 體의 의미를 억지로 풀이하기보다, 여기서는 소리를 보태는 요소로 구분하는 편이 안전합니다.'
    },
    '智': {
      type: '구성자', key: '知 + 日', era: '후대 자형에서 구조가 뚜렷',
      origin: '智는 ‘지혜, 슬기, 판단하는 능력’을 뜻합니다. 현재 자형에서는 知와 日의 결합이 분명하게 보이며, 知의 ‘알다’라는 의미와 매우 가까운 의미 영역을 가집니다. 시험에서는 知 아래에 日이 놓인 위치 관계를 먼저 기억하면 좋습니다.',
      deep: '智는 단순히 정보를 안다는 뜻의 知보다, 아는 것을 바탕으로 판단하고 분별하는 능력을 가리킬 때 많이 쓰입니다. 智慧·明智 같은 말에서 이 차이가 잘 드러납니다.',
      caution: '고대 자형의 세부 해석에는 자서와 문자학 자료에 차이가 있으므로, “知+日이 곧 완전한 그림 이야기”라고 단정하지 않습니다.'
    },
    '仁': {
      type: '회의 계열', key: '亻 + 二', era: '전서에서 현재 구조가 선명',
      origin: '仁은 ‘어질다, 사람을 사랑하고 배려하다’라는 뜻입니다. 현재 자형은 사람을 뜻하는 亻과 二로 이루어져 있어, 교육에서는 ‘사람과 사람 사이의 바른 마음’이라는 기억 고리를 만들기 좋습니다.',
      deep: '유교에서 仁은 매우 중요한 덕목으로, 단순한 친절보다 넓은 인간적 배려와 도덕적 태도를 뜻합니다. 그래서 仁義·仁愛·仁德처럼 다른 덕목과 함께 자주 나타납니다.',
      caution: '“두 사람”이라는 설명은 기억법으로 유용하지만, 가장 이른 자형의 정확한 발생 과정을 한 문장으로 단정하는 설명은 피하는 편이 좋습니다.'
    },
    '義': {
      type: '회의 계열', key: '羊 + 我', era: '금문·전서에서 구성 확인',
      origin: '義는 ‘옳다, 마땅하다, 도리에 맞다’를 뜻합니다. 자형은 위의 羊과 아래의 我가 결합한 모습입니다. 고대에는 예의와 의례 속에서 ‘마땅함·바름’을 나타내는 의미로 발전해 오늘날의 정의·의리와 같은 뜻으로 이어졌습니다.',
      deep: '羊은 고대 문화에서 좋은 것·아름다운 것과 연결되는 경우가 많고, 我가 결합해 義의 자형을 이룹니다. 시험에서는 羊/我의 위아래 구조를 정확히 기억하는 것이 가장 실용적입니다.',
      caution: '“양이 나를 옳게 만든다” 같은 문장은 실제 자원 설명이 아니라 암기용 이야기이므로 구분해서 봅니다.'
    },
    '禮': {
      type: '회의·형성 계열', key: '礻 + 豊', era: '고대 제사·의례 문화와 관련',
      origin: '禮는 ‘예절, 예법, 의례’를 뜻합니다. 왼쪽 礻은 제사나 신과 관련된 뜻을 나타내고, 오른쪽 豊은 제사 그릇이나 풍성하게 차린 모습을 연상시키는 고대 자형과 연결됩니다. 그래서 본래 의례 행위와 밀접한 글자입니다.',
      deep: '시간이 지나면서 제사 절차만이 아니라 사람 사이에서 지켜야 할 규범과 예절까지 뜻이 넓어졌습니다. 禮節·禮儀·失禮에서 모두 같은 중심 의미를 확인할 수 있습니다.',
      caution: '礻은 示가 변으로 쓰일 때의 모양입니다. 衤와 형태가 비슷하므로 왼쪽 점과 획의 모양을 비교해 두면 좋습니다.'
    },
    '信': {
      type: '회의자', key: '亻 + 言', era: '전서에서 현재 구조 정착',
      origin: '信은 ‘믿다, 믿음, 신뢰’를 뜻합니다. 사람을 뜻하는 亻과 말을 뜻하는 言이 결합해, 사람이 한 말에 믿음이 있다는 의미를 연결하기 좋은 글자입니다.',
      deep: '信은 약속·신용·통신처럼 현대 한자어에서도 매우 넓게 쓰입니다. 특히 信用에서는 ‘믿을 수 있음’, 通信에서는 ‘소식이나 정보를 주고받음’이라는 방향으로 뜻이 확장됩니다.',
      caution: '“사람의 말은 반드시 믿어야 한다”는 식의 문장은 도덕적 기억법일 뿐, 글자의 모든 역사적 쓰임을 설명하는 것은 아닙니다.'
    },
    '東': {
      type: '고대 자형 계열', key: '전체 자형', era: '갑골문부터 방향 의미 사용',
      origin: '東은 ‘동쪽’을 뜻합니다. 오래된 자형은 묶인 자루나 꾸러미처럼 보이는 형태로 해석되기도 하며, 정확한 최초 그림의 뜻에는 여러 견해가 있습니다. 다만 매우 이른 시기부터 방향을 나타내는 東으로 사용된 것은 분명합니다.',
      deep: '교재에서 흔히 보는 “나무(木) 사이로 해(日)가 떠오른다”는 설명은 형태를 기억하기에는 좋지만, 현대 문자학에서는 글자의 실제 기원으로 그대로 받아들이지 않습니다.',
      caution: '실제 자원과 암기 이야기를 분리해 두는 대표적인 글자입니다.'
    },
    '西': {
      type: '고대 자형 계열', key: '전체 자형', era: '갑골문부터 확인',
      origin: '西는 ‘서쪽’을 뜻합니다. 초기 자형은 바구니나 둥지처럼 보이는 모습으로 해석되어 왔고, 본래 그림의 정확한 뜻에는 여러 견해가 있습니다. 이후 서쪽이라는 방향 의미가 굳어 현재까지 이어졌습니다.',
      deep: '東과 함께 한 쌍으로 익히면 방향 인출이 훨씬 빠릅니다. 西門·西方처럼 다른 글자 앞에 붙어 방향을 한정하는 방식도 자주 나타납니다.',
      caution: '새가 서쪽 둥지로 돌아간다는 설명은 유명한 기억법이지만, 자원의 세부 해석은 단정하지 않는 편이 정확합니다.'
    },
    '南': {
      type: '고대 자형 계열', key: '전체 자형', era: '갑골문·금문에서 확인',
      origin: '南은 ‘남쪽’을 뜻합니다. 가장 이른 자형은 매달린 악기나 물건처럼 보이는 모습으로 설명되기도 하며, 본래 그림이 무엇이었는지는 학설이 나뉩니다. 방향으로서의 남쪽 뜻은 매우 오래전부터 사용되었습니다.',
      deep: '南은 자형이 복잡해 보이지만 바깥 윤곽과 안쪽 부분을 덩어리로 보면 안정적입니다. 南門·南方·南北처럼 방향 어휘에서 반복적으로 쓰입니다.',
      caution: '글자 내부를 현대의 다른 한자 몇 개로 억지 분해해 기원을 설명하는 방식은 피합니다.'
    },
    '北': {
      type: '상형·회의 계열', key: '등진 두 사람', era: '갑골문에서 형태가 뚜렷',
      origin: '北의 초기 자형은 두 사람이 등을 맞대고 반대 방향을 보는 모습으로 설명됩니다. 그래서 본래 ‘등지다’와 관련된 뜻을 가졌고, 이후 방향인 ‘북쪽’을 나타내는 글자로 널리 쓰이게 되었습니다.',
      deep: '오늘날 ‘등 배’의 뜻은 背가 맡고, 北은 주로 방향을 뜻합니다. 같은 뿌리에서 의미가 갈라진 사례로 보면 기억하기 좋습니다.',
      caution: '南과 반대라는 단순 암기뿐 아니라, 좌우가 서로 등진 모양이라는 시각적 특징을 함께 기억하세요.'
    },
    '父': {
      type: '상형 계열', key: '손 + 도구', era: '갑골문에서 확인',
      origin: '父는 ‘아버지’를 뜻합니다. 초기 자형은 손에 막대기나 도구를 든 모습으로 설명되며, 집안의 어른이나 아버지를 가리키는 뜻으로 발전했습니다.',
      deep: '현대에는 父母·父子·祖父처럼 가족 관계를 나타내는 한자어에서 가장 자주 만납니다. 획수가 적기 때문에 교차 지점과 삐침의 방향을 정확히 쓰는 것이 중요합니다.',
      caution: '고대 사회의 역할을 그대로 현대 가족의 역할과 연결해 해석할 필요는 없습니다.'
    },
    '母': {
      type: '상형자', key: '여성의 모습', era: '갑골문부터 확인',
      origin: '母는 ‘어머니’를 뜻하는 상형 계열의 글자입니다. 女와 관련된 고대 사람 모양에 어머니임을 나타내는 특징이 더해진 형태가 변화하여 현재 자형이 되었습니다.',
      deep: '父母·母子·祖母처럼 가족 관계에서 반복적으로 사용됩니다. 현재 자형에서는 가운데의 두 점과 바깥 획의 위치가 핵심 형태 단서입니다.',
      caution: '고대 그림의 세부 묘사를 지나치게 사실적으로 외우기보다 현재 자형의 점과 가로획 위치를 우선 익히세요.'
    },
    '兄': {
      type: '회의 계열', key: '口 + 사람 모양', era: '갑골문·금문에서 확인',
      origin: '兄은 ‘형, 손위 남자 형제’를 뜻합니다. 초기 자형은 입을 뜻하는 口와 사람을 나타내는 부분이 결합한 모습으로, 집단이나 제사에서 말을 맡는 연장자의 역할과 관련해 설명되기도 합니다.',
      deep: '현재 학습에서는 위쪽 口와 아래 사람 모양의 크기 비율을 익히는 것이 중요합니다. 兄弟를 한 묶음으로 자주 인출하면 뜻과 음이 함께 고정됩니다.',
      caution: '口가 있다고 해서 단순히 “입이 큰 사람이 형”이라고 보는 것은 암기 이야기일 뿐입니다.'
    },
    '弟': {
      type: '고대 자형 계열', key: '감긴 줄 모양', era: '갑골문부터 확인',
      origin: '弟는 ‘아우, 손아래 형제’를 뜻합니다. 초기 자형은 끈이나 줄이 어떤 물체에 차례로 감긴 모습과 관련해 해석되며, ‘차례·순서’의 의미에서 손아래 형제를 나타내는 뜻으로 이어졌다고 봅니다.',
      deep: '현재 글씨에서는 위쪽의 점과 가로획, 가운데 굽은 부분, 아래로 뻗는 획을 순서대로 덩어리화하면 쓰기가 편해집니다.',
      caution: '현대 자형만 보고 다른 한자들을 억지로 조합해 유래를 만들지 않는 편이 좋습니다.'
    },
    '婦': {
      type: '회의 계열', key: '女 + 帚', era: '갑골문부터 유사 구조 확인',
      origin: '婦는 ‘아내, 며느리, 부인’을 뜻합니다. 女와 빗자루를 뜻하는 帚가 결합한 자형으로 전해지며, 고대 가정과 의례 속 여성의 역할을 반영한 글자로 설명됩니다.',
      deep: '夫婦·婦人·主婦 같은 한자어에서 쓰입니다. 오늘날의 가치관을 설명하는 글자가 아니라 고대 사회의 언어와 문화를 담은 문자라는 점을 함께 기억하면 좋습니다.',
      caution: '자원은 역사적 배경 설명이지 현대의 성 역할을 정당화하는 설명이 아닙니다.'
    },
    '夫': {
      type: '상형·지사 계열', key: '大 + 머리 위 획', era: '갑골문·금문에서 확인',
      origin: '夫는 ‘성인 남자, 남편’을 뜻합니다. 사람을 크게 그린 大와 비슷한 몸체 위에 성인이 되었음을 나타내는 표지가 더해진 자형으로 설명됩니다.',
      deep: '大와 매우 비슷하므로 “위에 가로획 하나가 더 있다”는 형태 비교가 시험에서 특히 유용합니다. 夫婦·夫人·丈夫처럼 사람을 가리키는 말에서 자주 보입니다.',
      caution: '大와 夫는 획 하나 차이이므로 첫 두 가로획의 높이 차이를 쓰면서 확인하세요.'
    },
    '結': {
      type: '형성자', key: '糹 + 吉', era: '전서에서 구조가 명확',
      origin: '結은 ‘맺다, 묶다’를 뜻합니다. 실을 나타내는 糹가 뜻을 맡고 吉이 소리를 보태는 형성자입니다. 실로 무엇인가를 묶어 연결한다는 중심 의미에서 ‘결과를 맺다, 결론을 맺다’ 같은 추상적 뜻도 생겼습니다.',
      deep: '結婚·結果·結論처럼 매우 다른 단어에 들어가지만 공통적으로 “묶여 하나의 상태나 끝에 이른다”는 의미 고리를 만들 수 있습니다.',
      caution: '왼쪽 糹의 작은 획들을 빠뜨리지 말고, 오른쪽 吉과의 좌우 폭을 비교해 쓰세요.'
    },
    '婚': {
      type: '형성자', key: '女 + 昏', era: '전서에서 현재 구조 정착',
      origin: '婚은 ‘혼인하다, 결혼’을 뜻합니다. 女가 의미 범주를 나타내고 昏이 주로 소리를 보태는 형성자입니다. 고대 혼례가 저녁 무렵 행해졌다는 문화적 배경 때문에 昏의 ‘해 질 무렵’ 의미도 함께 연상되곤 합니다.',
      deep: '結婚·婚姻·新婚에서처럼 혼인과 관련된 한자어에 집중적으로 쓰입니다. 女와 昏의 좌우 구조를 확실히 익히면 비슷한 복잡한 글자와 구분하기 쉽습니다.',
      caution: '“저녁에만 결혼해서 婚이 되었다”처럼 한 가지 이야기로 자원을 단정하기보다, 女는 뜻 요소이고 昏은 소리 요소라는 형성 구조를 중심으로 기억합니다.'
    }
  };

  function patchOrigins() {
    if (typeof hanjaSet === 'undefined') return;
    hanjaSet.forEach(item => {
      const info = etymology[item.char];
      if (!info) return;
      item.origin = info.origin;
      item.originExtra = info;
    });
  }

  function installFilterDefs() {
    if (document.getElementById('pinconLoreGlassDefs')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pinconLoreGlassDefs';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><defs>
      <filter id="pincon-lore-glass-displace" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="1" seed="8" result="noise"/>
        <feGaussianBlur in="noise" stdDeviation="1.8" result="softNoise"/>
        <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="5" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs></svg>`;
    document.body.appendChild(wrap);
  }

  function installLoreGlass() {
    const disc = document.querySelector('.lens-disc');
    const lens = document.getElementById('lens');
    if (!disc || !lens || disc.dataset.loreGlass === 'ready') return;
    disc.dataset.loreGlass = 'ready';
    installFilterDefs();

    ['refraction','chroma','specular'].forEach(name => {
      const layer = document.createElement('div');
      layer.className = `lore-glass-${name}`;
      layer.setAttribute('aria-hidden', 'true');
      disc.prepend(layer);
    });

    document.querySelectorAll('.topbar,.study-meta,.mode-tabs,.bottom-nav,.detail-panel').forEach(el => {
      el.dataset.glassSurface = 'true';
    });

    if (!motion || reduced) return;
    let targetX = .5, targetY = .28, targetPress = 0;
    const x = new motion.MotionValue(.5);
    const y = new motion.MotionValue(.28);
    const press = new motion.MotionValue(0);
    const sx = new motion.SpringDriver(x, { stiffness: 72, damping: 16 }, () => targetX);
    const sy = new motion.SpringDriver(y, { stiffness: 72, damping: 16 }, () => targetY);
    const sp = new motion.SpringDriver(press, { stiffness: 150, damping: 20 }, () => targetPress);

    x.on(v => disc.style.setProperty('--glass-x', `${(v * 100).toFixed(2)}%`));
    y.on(v => disc.style.setProperty('--glass-y', `${(v * 100).toFixed(2)}%`));
    press.on(v => disc.style.setProperty('--glass-press', Math.max(0, Math.min(1, v)).toFixed(3)));

    const point = event => {
      const rect = lens.getBoundingClientRect();
      targetX = Math.max(.08, Math.min(.92, (event.clientX - rect.left) / rect.width));
      targetY = Math.max(.08, Math.min(.92, (event.clientY - rect.top) / rect.height));
      sx.start(); sy.start();
    };
    lens.addEventListener('pointermove', point, { passive: true });
    lens.addEventListener('pointerdown', event => { point(event); targetPress = 1; sp.start(); });
    const release = () => { targetPress = 0; sp.start(); };
    lens.addEventListener('pointerup', release);
    lens.addEventListener('pointercancel', release);
    lens.addEventListener('pointerleave', () => {
      targetX = .5; targetY = .28; targetPress = 0;
      sx.start(); sy.start(); sp.start();
    });
  }

  let mainWriter = null;
  let guideWriter = null;
  let renderToken = 0;

  function createVectorLayer() {
    const disc = document.querySelector('.lens-disc');
    const strokeLayer = document.getElementById('strokeLayer');
    if (!disc) return null;
    let layer = disc.querySelector('.vector-glyph-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'vector-glyph-layer';
      layer.setAttribute('aria-hidden', 'true');
      if (strokeLayer) disc.insertBefore(layer, strokeLayer);
      else disc.appendChild(layer);
    }
    return layer;
  }

  function renderMainGlyph(animate = true) {
    if (!window.HanziWriter) return;
    const source = document.getElementById('mainChar');
    const layer = createVectorLayer();
    if (!source || !layer) return;
    const char = source.textContent.trim();
    if (!char) return;
    const token = ++renderToken;
    const box = layer.getBoundingClientRect();
    const size = Math.max(180, Math.floor(Math.min(box.width || 260, box.height || 260)));
    const targetId = `vectorGlyphTarget-${token}`;
    layer.innerHTML = `<div id="${targetId}"></div>`;
    try {
      mainWriter = HanziWriter.create(targetId, char, {
        width: size,
        height: size,
        padding: Math.max(10, Math.round(size * .045)),
        showOutline: false,
        showCharacter: true,
        strokeColor: '#1d1d1a',
        radicalColor: '#bd332e'
      });
    } catch (_) {
      layer.textContent = char;
      layer.style.fontFamily = 'serif';
      layer.style.fontSize = `${size * .72}px`;
    }
    if (animate && !reduced) {
      layer.classList.remove('is-changing');
      void layer.offsetWidth;
      layer.classList.add('is-changing');
      const reading = document.querySelector('.reading-block');
      reading?.classList.remove('is-changing');
      if (reading) { void reading.offsetWidth; reading.classList.add('is-changing'); }
      document.querySelectorAll('.side-preview').forEach(el => {
        el.classList.remove('is-pulsing'); void el.offsetWidth; el.classList.add('is-pulsing');
      });
    }
  }

  function renderWritingGuide() {
    if (!window.HanziWriter) return;
    const board = document.getElementById('writingBoard');
    const source = document.getElementById('writingGuide');
    if (!board || !source) return;
    let layer = board.querySelector('.vector-writing-guide');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'vector-writing-guide';
      layer.setAttribute('aria-hidden', 'true');
      board.insertBefore(layer, board.querySelector('canvas'));
    }
    const char = source.textContent.trim();
    if (!char) return;
    const box = board.getBoundingClientRect();
    const size = Math.max(220, Math.floor(Math.min(box.width || 320, box.height || 320) * .84));
    const id = `vectorWritingGuide-${Date.now()}`;
    layer.innerHTML = `<div id="${id}"></div>`;
    try {
      guideWriter = HanziWriter.create(id, char, {
        width: size,
        height: size,
        padding: Math.round(size * .05),
        showOutline: false,
        showCharacter: true,
        strokeColor: '#777872',
        radicalColor: '#777872'
      });
    } catch (_) {}
  }

  function injectOriginExtra() {
    const panel = document.getElementById('detailPanel');
    const active = document.querySelector('.mode-tab.is-active')?.dataset.mode;
    if (!panel || active !== 'origin') return;
    const char = document.getElementById('mainChar')?.textContent.trim();
    const info = etymology[char];
    if (!info || panel.querySelector('.origin-extra')) return;
    const extra = document.createElement('div');
    extra.className = 'origin-extra';
    extra.innerHTML = `
      <div class="origin-meta">
        <span class="origin-chip">짜임 <b>${info.type}</b></span>
        <span class="origin-chip">구조 <b>${info.key}</b></span>
        <span class="origin-chip">자형 <b>${info.era}</b></span>
      </div>
      <div class="origin-deep">${info.deep}</div>
      <p class="origin-caution"><strong>자원 주의</strong> · ${info.caution}</p>`;
    panel.appendChild(extra);
  }

  function animatePanel() {
    const panel = document.getElementById('detailPanel');
    if (!panel || reduced) return;
    panel.classList.remove('is-motion-swapping');
    void panel.offsetWidth;
    panel.classList.add('is-motion-swapping');
  }

  function installObservers() {
    const main = document.getElementById('mainChar');
    if (main) {
      let last = main.textContent.trim();
      new MutationObserver(() => {
        const next = main.textContent.trim();
        if (!next || next === last) return;
        last = next;
        requestAnimationFrame(() => renderMainGlyph(true));
      }).observe(main, { childList: true, characterData: true, subtree: true });
    }

    const panel = document.getElementById('detailPanel');
    if (panel) {
      let scheduled = false;
      new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          injectOriginExtra();
        });
      }).observe(panel, { childList: true, subtree: true });
    }

    const guide = document.getElementById('writingGuide');
    if (guide) {
      new MutationObserver(() => requestAnimationFrame(renderWritingGuide))
        .observe(guide, { childList: true, characterData: true, subtree: true });
    }

    const dialog = document.getElementById('writeDialog');
    if (dialog) {
      new MutationObserver(() => {
        if (dialog.open) requestAnimationFrame(() => requestAnimationFrame(renderWritingGuide));
      }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    }
  }

  function installInteractionMotion() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        requestAnimationFrame(() => {
          animatePanel();
          injectOriginExtra();
        });
      });
    });

    const weak = document.querySelector('.weak-section');
    if (weak && 'IntersectionObserver' in window && !reduced) {
      weak.classList.add('motion-reveal');
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          weak.classList.add('is-revealed');
          io.disconnect();
        }
      }, { threshold: .16 });
      io.observe(weak);
    }

    document.querySelectorAll('.weak-list,.usage-grid').forEach(list => {
      list.addEventListener('click', event => {
        const card = event.target.closest('button,.weak-card,.usage-card');
        if (!card || reduced) return;
        card.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(.975)' },
          { transform: 'scale(1.012)' },
          { transform: 'scale(1)' }
        ], { duration: 420, easing: motion?.cssEase || 'ease-out' });
      });
    });
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderMainGlyph(false);
      const dialog = document.getElementById('writeDialog');
      if (dialog?.open) renderWritingGuide();
    }, 120);
  }

  function init() {
    patchOrigins();
    installLoreGlass();
    installObservers();
    installInteractionMotion();
    requestAnimationFrame(() => renderMainGlyph(false));
    window.addEventListener('resize', onResize, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
