# Pincon

Pincon은 1~3학년, 학년별 1~10반까지 총 30개 학급을 지원하는 학교생활 PWA입니다. 공지, 시간표 변경, 체육 장소, 준비물, 수행평가·학사 일정, 모둠 정보를 학급별로 실시간 동기화합니다.

화면의 버튼, 칩, 목록, 탭, 체크박스, 대화상자, 선택·입력 필드와 FAB는 Google의 공식 `@material/web` Material 3 컴포넌트만 사용합니다. 별도 재사용 UI 컴포넌트는 만들지 않았고, 하단 플로팅 `md-tabs`와 운영자 `md-fab`를 유지합니다.

## 현재 데이터 상태

- 앱에는 예시 공지, 예시 시간표, 학생 이름 등 시드·더미 데이터가 없습니다.
- 첫 실행에서 사용자가 학년과 반을 선택합니다.
- Firebase 설정 전에는 각 화면이 올바른 빈 상태로 표시됩니다.
- Firebase 설정 후에는 선택한 반에 해당하는 Firestore 문서만 실시간으로 구독합니다.

## 지원 기능

- 학급 범위: 1~3학년 × 1~10반
- 공개 범위: 현재 반, 현재 학년 전체, 전교 전체
- 콘텐츠: 공지, 시간표·장소 변경, 준비물, 일정·D-day, 모둠 구성원
- 동기화: Firestore `onSnapshot` 실시간 반영
- 오프라인: Firestore IndexedDB 다중 탭 캐시와 재연결 시 자동 업로드
- 공동 편집: Google 로그인한 학생은 현재 학급의 모든 콘텐츠를 등록·수정하고, 기존 공개 범위를 유지한 채 보이는 항목을 수정할 수 있음
- 변경 기록: 등록·수정·삭제 이력을 20개까지 표시하고 이전 상태로 복원
- 운영자: `roles/{uid}` 문서에 등록된 학교 운영자는 학년·전교 범위까지 발행 가능
- NEIS: 고촌고등학교 급식 자동 조회, 30개 학급 시간표 30분 주기 동기화와 변경 감지
- 알림: 시간표 변경 시 학급 공지 생성과 설치형 PWA 웹 푸시
- PWA: 홈 화면 설치, 독립 실행, 앱 셸 오프라인 캐시, 자동 업데이트
- 화면: 휴대폰, 태블릿, 크롬북, 데스크톱 반응형

## 로컬 실행

```bash
npm install
npm run dev
```

빌드와 테스트:

```bash
npm run build
npm test
```

## Firebase 연결

1. Firebase 콘솔에서 프로젝트와 웹 앱을 만듭니다.
2. Authentication에서 Google 로그인을 켜고 `doetoeri.github.io`를 승인된 도메인에 추가합니다.
3. Firestore 데이터베이스를 만듭니다.
4. `public/firebase-config.example.js`를 참고해 `public/firebase-config.js`의 `null`을 실제 웹 앱 설정 객체로 교체합니다.
5. Firebase CLI에서 `firebase deploy --only firestore`를 실행해 `firestore.rules`와 인덱스를 배포합니다. Firebase 콘솔을 사용한다면 Firestore의 **규칙** 탭에 `firestore.rules` 내용을 붙여넣고 게시해도 됩니다.
6. 최초 학교 운영자 계정은 Firebase 콘솔에서 다음 경로에 직접 추가합니다.

```text
schools/gochon-high/roles/{Firebase Authentication UID}
```

전교 운영자 문서 예시:

```json
{
  "enabled": true,
  "level": "school",
  "classKeys": []
}
```

학급 운영자 문서 예시:

```json
{
  "enabled": true,
  "level": "class",
  "classKeys": ["1-3"]
}
```

학년 운영자는 `level`을 `grade`로 하고, 해당 학년 10개 반을 `classKeys`에 넣으며 앱 표시용 `grades` 배열도 함께 둡니다.

```json
{
  "enabled": true,
  "level": "grade",
  "grades": [1],
  "classKeys": ["1-1", "1-2", "1-3", "1-4", "1-5", "1-6", "1-7", "1-8", "1-9", "1-10"]
}
```

Firebase 웹 설정의 API 키는 비밀번호가 아닙니다. 실제 읽기·쓰기 권한은 저장소에 포함된 `firestore.rules`가 서버에서 검사합니다. 서비스 계정 키나 관리자 비밀키는 절대로 프런트엔드 파일에 넣지 마세요.

## NEIS 자동 동기화와 알림 활성화

저장소의 `.github/workflows/neis-sync.yml`은 30분마다 고촌고등학교 NEIS 시간표와 급식을 확인합니다. 처음 실행할 때는 기준 시간표만 저장하고, 이후 과목이 달라졌을 때만 해당 반 공지와 푸시를 만듭니다.

GitHub 저장소의 **Settings → Secrets and variables → Actions**에 다음 Repository secret 두 개를 직접 등록합니다.

- `NEIS_API_KEY`: NEIS 교육정보 개방 포털에서 발급받은 인증키
- `FIREBASE_SERVICE_ACCOUNT_JSON`: Firebase **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 받은 JSON 파일의 전체 내용

서비스 계정 JSON은 비밀키이므로 채팅, 저장소 파일, `firebase-config.js`에 넣지 마세요. GitHub Secrets에만 보관합니다.

설치 앱 알림은 Firebase **프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서**에서 키 쌍을 만든 뒤, 공개 키만 `public/firebase-config.js`의 `vapidKey`에 넣으면 활성화됩니다. 브라우저 정책상 각 학생은 더보기 화면에서 **알림 켜기**를 한 번 눌러 직접 허용해야 합니다.

설정 후 GitHub의 **Actions → NEIS timetable sync → Run workflow**로 최초 동기화를 한 번 실행합니다. 이 최초 실행은 변경 공지를 만들지 않고 비교 기준만 저장합니다.
