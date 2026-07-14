# Pine

학교 곳곳에 흩어진 공고와 전단지를 한곳에서 찾고, 누구나 새 소식을 올리는 반응형 HTML 앱입니다. Figma의 **Pine Zigzag Design System**을 기준으로 `Responsive Plate` 카드·버튼·배너·토스트와 디자인 토큰을 순수 HTML/CSS/JavaScript로 구현했습니다.

## 바로 실행하기

정적 파일이므로 별도 빌드가 없습니다. 로컬 서버에서 `index.html`을 열면 됩니다.

```powershell
python -m http.server 4173
```

브라우저에서 `http://localhost:4173`으로 접속하세요. 클라우드 설정 전에도 샘플 공고와 `localStorage` 기반 등록·탭 간 동기화가 동작합니다.

## 모든 기기 실시간 동기화 켜기

1. Supabase 프로젝트를 하나 만듭니다.
2. Supabase의 **SQL Editor**에서 `supabase.sql` 전체를 실행합니다.
3. 프로젝트의 **Settings → API**에서 Project URL과 anon public key를 복사합니다.
4. `config.js`를 아래처럼 채웁니다.

```js
window.PINE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_ANON_PUBLIC_KEY",
  showDemoContent: true,
};
```

설정 후에는 공고 데이터가 Supabase Postgres에 저장되고, 전단 이미지는 `flyers` Storage 버킷에 올라가며, Realtime 채널을 통해 열려 있는 모든 기기에 즉시 반영됩니다. anon key는 브라우저에 공개되는 키이므로 `service_role` 키를 넣으면 안 됩니다.

## 주요 기능

- 제목·단체·태그 통합 검색 및 카테고리 필터
- 최신순, 마감 임박순, 관심순 정렬
- 격자/목록 전환과 모바일 하단 내비게이션
- 누구나 공고 등록, 전단 이미지 압축·미리보기·업로드
- 이미지가 없을 때 Pine 스타일 자동 포스터 생성
- 관심 공고 로컬 저장, 상세 보기, Web Share/링크 복사
- Supabase Realtime 기반 다기기 동기화
- 설정 누락 또는 연결 실패 시 로컬 데모 모드

## 운영 전 권장사항

현재 요구사항대로 익명 등록을 허용합니다. 실제 학교 전체 공개 운영 전에는 스팸 방지를 위해 CAPTCHA, 제출 빈도 제한, 관리자 검수 상태(`pending/approved`)를 추가하는 편이 안전합니다. 읽기·등록 외 수정과 삭제 권한은 현재 공개되어 있지 않습니다.
