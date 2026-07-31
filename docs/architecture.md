# 프로젝트 구조

## 전체 원칙

AutoM은 화면을 담당하는 `frontend`와 Electron 메인 프로세스 및 기능을 담당하는 `backend`를 분리합니다. 화면은 `window.api`로 공개된 기능만 호출하며 파일 시스템, 로그인 세션, API 키 저장소에 직접 접근하지 않습니다.

```text
AutoM/
├─ frontend/
│  ├─ blog/                 # 블로그 전용 화면
│  ├─ creator/              # Creator 대시보드와 플랫폼별 화면
│  └─ shared/               # 두 앱이 함께 쓰는 디자인, 로고와 View 장식
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

- `frontend/blog`: 블로그 입력, 미리보기, 발행 기록, 설정 화면
- `frontend/creator`: 대시보드, 블로그, 인스타그램, YouTube, 통합 기록, 설정 화면
- `frontend/shared`: 두 앱의 앱 셸, 디자인 토큰, 플랫폼 로고와 블로그·기록·설정 View 장식
- AutoM과 Creator는 같은 공통 디자인 파일을 사용하며, 각 앱은 실제 제공 기능에 맞는 메뉴와 설정만 노출합니다.
- 기존 element ID, `data-tab`, input name/value는 이벤트 계약이므로 변경할 때 테스트가 필요합니다.

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
frontend -> preload(window.api) -> IPC -> features/core/shared
apps -> shared + features
features -> core + shared
shared -> core + blog feature
```

구조를 바꾼 뒤에는 `npm run check:architecture`를 실행해 필수 경로, 진입점, 상대 import를 확인합니다.
