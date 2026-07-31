# AutoM

AutoM은 AI를 이용해 네이버 블로그 글, 인스타그램 카드뉴스, YouTube 영상 초안을 만드는 Windows 데스크톱 프로그램입니다.

- `AutoM`: 네이버 블로그 전용 앱
- `AutoM Creator`: 블로그, 인스타그램, YouTube 기능을 함께 제공하는 앱

## 빠른 시작

```bash
npm start
npm run start:creator
```

처음 개발 환경을 구성할 때만 `npm install`과 `npx playwright install chromium`이 필요합니다.

## 문서

- [사용자 안내서](docs/user-guide.md)
- [개발 및 빌드 방법](docs/development.md)
- [프로젝트 구조](docs/architecture.md)
- [테스트 및 검증 방법](docs/testing.md)

## 주요 검사

```bash
npm run check:architecture
npm test
npm run test:creator
npm run test:ui
```

API 키는 Electron `safeStorage`를 통해 운영체제 자격 증명으로 암호화됩니다. 실제 로그인, AI 생성, 발행 및 연결 테스트는 외부 서비스 요청이 발생할 수 있으므로 운영 계정에서 실행하기 전에 [사용자 안내서](docs/user-guide.md)를 확인하세요.
