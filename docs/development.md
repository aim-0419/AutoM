# 개발 및 빌드

## 기술 스택

- JavaScript
- HTML / CSS
- Node.js
- Electron
- Playwright
- Anthropic, OpenAI, Google 생성형 AI SDK
- electron-builder / NSIS

React, Vite, TypeScript, 별도 데이터베이스는 사용하지 않습니다. 사용자의 설정과 발행 기록은 로컬 파일에 저장됩니다.

## 요구 사항

- Node.js 20 이상
- Windows 10 또는 Windows 11
- 최초 설치 시 Playwright Chromium

## 개발 실행

```bash
npm install
npx playwright install chromium
npm start
npm run start:creator
```

- `npm start`: 블로그 전용 AutoM 실행
- `npm run start:creator`: AutoM Creator 실행

## 빌드

```bash
npm run build:win
npm run build:creator
```

빌드 전에 `npx playwright install chromium`이 한 번 실행되어 있어야 합니다. 빌드 명령은 `prepare:chromium`을 통해 Chromium과 YouTube 영상 처리용 FFmpeg를 `vendor/ms-playwright`에 준비한 뒤 설치 파일에 포함합니다.

- 블로그 설치 파일: `dist/AutoM Setup.exe`
- Creator 설치 파일: `dist-creator/AutoM Creator Setup.exe`

## 코드 변경 원칙

1. 화면 변경은 `frontend`에서 시작합니다.
2. 외부 서비스 또는 파일 작업은 `backend/features`에 둡니다.
3. 여러 플랫폼이 함께 쓰는 규칙은 `backend/core` 또는 `backend/shared`에 둡니다.
4. API 키, 쿠키, 세션, 토큰은 코드와 로그에 출력하지 않습니다.
5. IPC 채널이나 화면 selector를 바꾸면 preload, 테스트, 문서를 함께 갱신합니다.
6. 새 라이브러리는 기존 표준 모듈로 해결할 수 없는 경우에만 추가합니다.

## 공급자 단독 테스트

공급자 테스트는 실제 외부 API를 호출합니다. 테스트 전용 키와 비용 한도를 확인한 환경에서만 실행하세요.

```bash
ANTHROPIC_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... npm run test:providers
```
