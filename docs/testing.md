# 테스트 및 검증

## 외부 요청이 없는 기본 검사

```bash
npm run check:architecture
npm test
npm run test:creator
npm run test:ui
npm run test:youtube-ui
```

- `check:architecture`: 필수 폴더, Electron 진입점, 상대 import 경로 검사
- `npm test`: 블로그 생성, 품질, 일정, 설정, 네이버 발행 보조 로직 검사
- `test:creator`: 인스타그램, YouTube, Creator 화면 계약 검사
- `test:ui`: 두 앱의 전체 탭을 두 해상도로 열어 레이아웃, 콘솔 오류, 외부 요청 검사
- `test:youtube-ui`: 로컬 샘플 영상으로 YouTube 결과 화면과 영상 옵션 검사

## 화면 회귀검증

Electron 화면 검증 시에는 운영 사용자 데이터와 분리된 임시 `userData` 폴더를 사용합니다.

`test:ui`가 자동으로 검사하는 항목:

1. `1280x860`, `1000x700`에서 문서 가로 넘침이 없는지
2. 잘린 컨트롤(`scrollWidth > clientWidth`)과 화면 밖으로 나간 컨트롤이 없는지
3. 내용(글자·이미지)이 `.creator-page-inner` 영역 오른쪽으로 삐져나오지 않았는지
4. 중복 ID, 브라우저 콘솔 오류, 외부 HTTP 요청이 0인지
5. 모든 탭이 정상 전환되고 각 화면의 핵심 요소가 존재하는지

넘침 검사는 **가장 불리한 조건**에서 이뤄집니다. 검사 시작 전에 임시 프로필로 다음을 주입합니다.

- 띄어쓰기 없는 아주 긴 한글 키워드·제목과 긴 URL을 담은 가짜 발행 기록 (플랫폼별 2건씩)
- 인스타그램 결과 화면: 긴 제목·캡션·경로와 카드 6장 (`renderOutput`)
- 유튜브 결과 화면: 긴 제목·경로·검토 문구와 장면 8개 (`renderYoutubeOutput`)

가짜 결과가 실제로 그려졌는지도 함께 확인하므로, 검사 대상이 없는데 "통과"로 나오는 일은 없습니다.

사람이 직접 볼 것:

- 입력 필드와 버튼의 Tab 포커스 순서
- 블로그, 인스타그램, YouTube 아이콘과 빈 상태 화면
- API 키, 로그인, 추천, 생성, 발행 버튼은 안전 QA에서 클릭하지 않음

## 디자인 스냅샷 비교

`frontend/shared/styles/app.css`는 규칙이 여러 겹으로 덮어쓰는 구조라, 규칙 순서를 바꾸거나 파일을 나누면
겉모습이 바뀝니다. 순서에 영향을 주는 수정을 할 때는 전후를 기계적으로 비교합니다.

```bash
node scripts/capture-style-snapshot.js before
# (수정)
node scripts/capture-style-snapshot.js after
node scripts/capture-style-snapshot.js compare
```

두 앱의 34개 화면에 있는 모든 요소의 위치·크기·색·글꼴 등 56개 속성을 비교해, 한 곳이라도 달라지면 알려 줍니다.
의도한 디자인 변경이라면 차이가 나는 것이 정상이므로, 차이 목록이 의도한 범위인지 확인하고 넘어갑니다.

## 실제 서비스 테스트

다음 검증은 외부 서비스 요청 또는 비용이 발생합니다.

- AI 연결 테스트
- 키워드 자동추천
- 텍스트 및 이미지 생성
- 네이버, 인스타그램 로그인
- 실제 발행 및 예약 발행

운영 계정에서 실행하기 전에 백업, 공개 범위, 예약 시각, 생성 비용을 확인합니다. YouTube 기능은 자동 업로드하지 않고 로컬 편집용 결과물을 생성합니다.

## 빌드 검증

```bash
npm run build:win
npm run build:creator
```

설치 파일만 만들어졌다고 완료로 판정하지 않습니다. 패키징된 앱에서 다음을 추가로 확인합니다.

- 앱 실행과 창 표시
- 번들된 Chromium 및 FFmpeg 경로
- 설정과 기록 저장 위치
- 아이콘과 정적 파일 로딩
- 개발 경로에 의존하는 상대 경로가 없는지 확인
