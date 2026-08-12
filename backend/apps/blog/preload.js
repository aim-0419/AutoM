const { contextBridge, ipcRenderer } = require('electron');

/**
 * [블로그 앱 - 화면과 프로그램 내부를 잇는 '창구' 역할]
 *
 * 비개발자를 위한 설명:
 * - 이 프로그램은 "화면(버튼·입력창이 있는 부분)"과 "내부 기능(AI 호출·파일 저장·자동 로그인)"이
 *   완전히 분리되어 있습니다. 화면은 인터넷 페이지와 같아서, 만약 화면이 컴퓨터 파일에
 *   마음대로 접근할 수 있다면 보안상 매우 위험합니다.
 * - 그래서 이 파일이 은행 창구처럼 중간에 서서, "여기 적힌 기능만" 화면이 요청할 수 있게 합니다.
 * - 화면 코드에서는 `window.api.naverLogin()` 처럼 부르면, 실제 작업은 내부(백엔드)에서 처리되고
 *   결과만 화면으로 돌아옵니다.
 *
 * 용어:
 * - invoke : "이 일 좀 해주고 결과 알려줘"라고 내부에 부탁하는 명령 (요청 후 답을 기다림)
 * - on     : "그 일 진행되면 계속 알려줘"라고 구독하는 명령 (진행 상황을 여러 번 받음)
 */
contextBridge.exposeInMainWorld('api', {
  // ── 설정 관련 ────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'), // 저장된 설정(AI 키, 출력 폴더 등) 불러오기
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch), // 바뀐 설정 항목만 저장하기
  testConnection: (payload) => ipcRenderer.invoke('settings:test-connection', payload), // 입력한 AI API 키가 실제로 동작하는지 시험 호출
  openApiKeyPage: (providerId) => ipcRenderer.invoke('settings:open-api-key-page', providerId), // API 키 발급 사이트를 기본 브라우저로 열기
  chooseOutputFolder: () => ipcRenderer.invoke('settings:choose-output-folder'), // 결과물을 저장할 폴더를 탐색기로 고르기

  // ── 네이버 블로그 로그인 / 발행 ──────────────────────────────
  naverLogin: () => ipcRenderer.invoke('naver:login'), // 네이버 로그인 창을 띄우고 로그인 상태를 저장
  naverResetSession: () => ipcRenderer.invoke('naver:reset-session'), // 저장된 로그인 정보를 지우기(계정 변경 시 사용)
  naverPublish: (payload) => ipcRenderer.invoke('naver:publish', payload), // 완성된 글을 실제 블로그에 올리기

  // ── 글 생성 파이프라인 ───────────────────────────────────────
  generateBatch: (payload) => ipcRenderer.invoke('pipeline:generate-batch', payload), // 키워드 여러 개로 글+이미지를 한 번에 생성
  cancelBatch: () => ipcRenderer.invoke('pipeline:cancel'), // 진행 중인 생성 작업 중단
  saveToFolder: (payload) => ipcRenderer.invoke('pipeline:save-to-folder', payload), // 생성 결과를 내 컴퓨터 폴더에 파일로 저장

  // ── 발행 기록 ────────────────────────────────────────────────
  historyList: () => ipcRenderer.invoke('history:list'), // 지금까지 발행한 목록 불러오기
  historyOpenUrl: (url) => ipcRenderer.invoke('history:open-url', url), // 기록에 있는 글 주소를 브라우저로 열기
  getUsedKeywords: () => ipcRenderer.invoke('history:get-used-keywords'), // 이미 써 본 키워드 목록(중복 방지용)
  getPublishedKeywords: () => ipcRenderer.invoke('history:get-published-keywords'), // 실제 발행까지 끝난 키워드 목록
  recommendKeyword: () => ipcRenderer.invoke('keyword:recommend'), // AI에게 새 키워드를 추천받기

  onPipelineProgress: (callback) => {
    // 글·이미지 생성과 자동발행 대기 상태를 화면에 실시간으로 알린다.
    // (예: "3개 중 1번째 글 작성 중", "이미지 생성 중", "발행 대기 12분")
    // 반환값을 호출하면 리스너를 제거해 화면을 다시 열었을 때 중복 수신을 막을 수 있다.
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },
});
