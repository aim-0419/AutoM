const { contextBridge, ipcRenderer } = require('electron');

/**
 * [Creator 앱 - 화면과 프로그램 내부를 잇는 '창구' 역할]
 *
 * 비개발자를 위한 설명:
 * - 블로그 전용 앱(AutoM)의 창구 파일과 같은 역할이지만, Creator는 블로그에 더해
 *   인스타그램·유튜브 기능까지 다루므로 공개하는 명령이 더 많습니다.
 * - 화면(버튼·입력창)은 여기에 적힌 이름만 부를 수 있고, 그 외 컴퓨터 파일이나
 *   운영체제 권한에는 절대 직접 닿지 못합니다. 보안을 위한 구조입니다.
 *
 * 용어:
 * - invoke : "이 일 좀 해주고 결과 알려줘" (한 번 요청 → 한 번 응답)
 * - on     : "진행되는 동안 계속 알려줘" (진행률을 여러 번 받아 화면에 표시)
 */
contextBridge.exposeInMainWorld('api', {
  // ── 공통 설정 ────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:get'), // 저장된 설정 불러오기
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch), // 바뀐 설정만 저장하기
  testConnection: (payload) => ipcRenderer.invoke('settings:test-connection', payload), // AI API 키 동작 확인
  openApiKeyPage: (providerId) => ipcRenderer.invoke('settings:open-api-key-page', providerId), // API 키 발급 사이트 열기
  chooseOutputFolder: () => ipcRenderer.invoke('settings:choose-output-folder'), // 결과물 저장 폴더 선택

  // ── 네이버 블로그 (블로그 전용 앱과 동일한 기능을 그대로 사용) ──
  naverLogin: () => ipcRenderer.invoke('naver:login'), // 네이버 로그인
  naverResetSession: () => ipcRenderer.invoke('naver:reset-session'), // 네이버 로그인 정보 초기화
  naverPublish: (payload) => ipcRenderer.invoke('naver:publish', payload), // 블로그에 글 발행
  generateBatch: (payload) => ipcRenderer.invoke('pipeline:generate-batch', payload), // 블로그 글 일괄 생성
  cancelBatch: () => ipcRenderer.invoke('pipeline:cancel'), // 생성 중단
  saveToFolder: (payload) => ipcRenderer.invoke('pipeline:save-to-folder', payload), // 결과를 폴더에 저장

  // ── 발행 기록 (블로그·인스타·유튜브 기록을 한곳에서 조회) ───────
  historyList: () => ipcRenderer.invoke('history:list'), // 전체 작업 기록 보기
  historyOpenUrl: (url) => ipcRenderer.invoke('history:open-url', url), // 기록 속 주소 열기
  getUsedKeywords: () => ipcRenderer.invoke('history:get-used-keywords'), // 이미 사용한 키워드
  getPublishedKeywords: () => ipcRenderer.invoke('history:get-published-keywords'), // 발행 완료된 키워드
  recommendKeyword: () => ipcRenderer.invoke('keyword:recommend'), // AI 키워드 추천

  // ── 인스타그램 ───────────────────────────────────────────────
  instagramSessionStatus: () => ipcRenderer.invoke('instagram:session-status'), // 지금 로그인되어 있는지 확인
  instagramLogin: () => ipcRenderer.invoke('instagram:login'), // 인스타그램 로그인 창 띄우기
  instagramResetSession: () => ipcRenderer.invoke('instagram:reset-session'), // 로그인 정보 지우기
  generateInstagramCarousel: (payload) => ipcRenderer.invoke('instagram:generate-carousel', payload), // 카드뉴스(여러 장 이미지) 만들기
  publishInstagramCarousel: (payload) => ipcRenderer.invoke('instagram:publish-carousel', payload), // 만든 카드뉴스를 인스타에 올리기

  // ── 유튜브 ───────────────────────────────────────────────────
  generateYoutubeProject: (payload) => ipcRenderer.invoke('youtube:generate-project', payload), // 대본·장면·자막·영상 초안 만들기
  openYoutubeOutput: (outputPath) => ipcRenderer.invoke('youtube:open-output', outputPath), // 만들어진 결과 폴더 열기
  openCapcutEditor: () => ipcRenderer.invoke('youtube:open-capcut'), // 영상 편집 도구(CapCut) 웹페이지 열기
  openYoutubeUploadPage: () => ipcRenderer.invoke('youtube:open-upload-page'), // 유튜브 업로드 페이지 열기

  // ── 진행 상황 실시간 알림 구독 ────────────────────────────────
  // 아래 함수들은 모두 "진행 상황이 생길 때마다 알려달라"고 등록하는 역할이며,
  // 돌려받은 함수를 실행하면 구독이 해제됩니다(화면을 옮겼을 때 중복 알림 방지).
  onPipelineProgress: (callback) => {
    // 블로그 글 생성 진행 상황
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },
  onInstagramProgress: (callback) => {
    // 인스타그램 카드 '생성' 진행 상황
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('instagram:progress', listener);
    return () => ipcRenderer.removeListener('instagram:progress', listener);
  },
  onInstagramPublishProgress: (callback) => {
    // 인스타그램 '발행(업로드)' 진행 상황
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('instagram:publish-progress', listener);
    return () => ipcRenderer.removeListener('instagram:publish-progress', listener);
  },
  onYoutubeProgress: (callback) => {
    // 유튜브 영상 프로젝트 생성 진행 상황
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
});
