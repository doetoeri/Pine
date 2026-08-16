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
- 운영자: Google 로그인 + `roles/{uid}` 문서 기반 권한
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
5. Firebase CLI에서 `firebase deploy --only firestore`를 실행해 `firestore.rules`와 인덱스를 배포합니다.
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
