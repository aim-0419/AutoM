# 프로젝트 구조

## 전체 원칙

AutoM은 화면을 담당하는 `frontend`와 Electron 메인 프로세스 및 기능을 담당하는 `backend`를 분리합니다. 화면은 `window.api`로 공개된 기능만 호출하며 파일 시스템, 로그인 세션, API 키 저장소에 직접 접근하지 않습니다.

프론트엔드와 백엔드는 **같은 3단 구조**(`apps` / `features` / `shared`)를 사용합니다. 어느 쪽을 보든 "앱 껍데기 → 기능 → 공통 도구" 순서로 찾으면 됩니다.

```text
AutoM/
├─ frontend/
│  ├─ apps/
│  │  ├─ blog/              # AutoM(블로그 전용) 창의 HTML과 화면 전환
│  │  └─ creator/           # AutoM Creator 창의 HTML과 화면 전환
│  ├─ features/             # 화면 한 개 = 폴더 한 개
│  │  ├─ blog/              # base.js(기능) + index.js(디자인·안내 덧붙이기)
│  │  ├─ history/           # base.js + index.js
│  │  ├─ settings/          # base.js + index.js
│  │  ├─ dashboard/         # Creator 전용
│  │  ├─ instagram/         # Creator 전용
│  │  └─ youtube/           # Creator 전용
│  └─ shared/               # 공통 디자인(styles), 로고(assets), 공통 도구(lib)
├─ backend/
│  ├─ apps/
│  │  ├─ blog/              # 블로그 앱 진입점과 preload
│  │  └─ creator/           # Creator 진입점, preload, 전용 IPC
│  ├─ core/                 # AI 공급자, 품질 검사, 일정 등 공통 핵심 로직
│  ├─ features/
│  │  ├─ blog/              # 네이버 로그인과 발행
│  │  ├─ instagram/         # 카드 생성, 로그인과 발행
│  │  └─ youtube/           # 대본, 장면, 자막과 WebM 생성
│  └─ shared/               # 설정, 기록, 로그와 공통 IPC
├─ docs/                    # 사용자 및 개발 문서
├─ scripts/                 # 테스트, QA, Chromium 번들 준비
├─ logs/                    # 개발 환경 로그
└─ package.json             # 실행, 테스트, 빌드 명령
```

## 프론트엔드

프론트엔드는 별도 프레임워크 없이 HTML, CSS, JavaScript ES Module로 구성되어 있습니다.

- `frontend/apps/<앱>`: 창의 HTML과 "메뉴를 누르면 어떤 화면을 보여줄지"만 담당합니다. 화면 내용은 갖고 있지 않습니다.
- `frontend/features/<기능>`: 화면 하나가 폴더 하나입니다. 두 앱이 함께 쓰는 blog·history·settings는 다음 두 파일로 나뉩니다.
  - `base.js`: 실제 기능(입력칸, 버튼, 저장·발행 요청)
  - `index.js`: 그 위에 안내 문구와 디자인을 덧붙이고 앱별 차이(`platformTabs`, `includeInstagram`)를 처리
- `frontend/shared`: 디자인 파일(`styles/base.css` → `styles/app.css` 순서로 적용), 플랫폼 로고, 공통 도구(`lib/html.js`).
- AutoM과 Creator는 같은 공통 디자인 파일을 사용하며, 각 앱은 실제 제공 기능에 맞는 메뉴와 설정만 노출합니다.
- 기존 element ID, `data-tab`, input name/value는 이벤트 계약이므로 변경할 때 테스트가 필요합니다.

### 디자인 파일을 고칠 때

`frontend/shared/styles/app.css`는 규칙이 여러 겹으로 덮어쓰는 구조라 **순서를 바꾸면 겉모습이 달라집니다.**
화면별로 파일을 쪼개려 시도했을 때 34개 화면에서 1,606곳의 모양 차이가 발생해 되돌린 이력이 있습니다.
순서에 영향을 주는 수정을 한다면 아래 도구로 전후를 비교하세요.

```bash
node scripts/capture-style-snapshot.js before
# (수정)
node scripts/capture-style-snapshot.js after
node scripts/capture-style-snapshot.js compare
```

## 백엔드

백엔드는 Node.js가 실행되는 Electron 메인 프로세스입니다.

- `backend/apps`: 창 생성, 보안 옵션, preload 및 IPC 등록
- `backend/core`: AI 공급자를 동일한 인터페이스로 묶고 품질·일정 규칙을 관리
- `backend/features`: 플랫폼별 생성, 로그인, 발행 기능
- `backend/shared`: 두 앱에서 함께 쓰는 설정, 기록, 로그, IPC

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`를 유지합니다. 프론트엔드에 새 기능을 공개할 때는 preload의 최소 API와 IPC 핸들러를 함께 검토해야 합니다.

## 데이터 저장

- 설정 및 API 키: Electron 사용자 데이터 폴더, `safeStorage` 암호화
- 로그인 세션: 플랫폼별 Chromium 프로필 폴더
- 발행 기록: Electron 사용자 데이터 폴더의 `history.json`
- 생성 결과: 사용자가 설정한 로컬 출력 폴더
- 개발 로그: 프로젝트의 `logs`, 설치본 로그는 사용자 데이터 폴더

블로그 전용 앱과 Creator는 서로 다른 Electron 앱 이름과 사용자 데이터 경로를 사용합니다.

## 의존 방향

```text
frontend/apps      -> frontend/features -> frontend/shared
frontend           -> preload(window.api) -> IPC -> backend
backend/apps       -> backend/features + backend/shared
backend/features   -> backend/core + backend/shared
```

의존은 **한 방향으로만** 흐릅니다. `shared`는 어떤 기능도 참조하지 않고, 기능끼리도 서로 참조하지 않습니다.
(예전에는 `frontend/shared`가 `frontend/blog`를 거꾸로 참조하고 있었는데, 기능별 폴더로 정리하면서 없앴습니다.)

구조를 바꾼 뒤에는 `npm run check:architecture`를 실행해 필수 경로, 진입점, 상대 import를 확인합니다.
