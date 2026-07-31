const { contextBridge, ipcRenderer } = require('electron');

/**
 * 화면(HTML/JavaScript)이 사용할 수 있는 기능 목록만 안전하게 공개한다.
 * 화면이 Node.js 파일 시스템이나 Electron 전체 권한에 직접 접근하지 못하게 하는 경계다.
 */
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testConnection: (payload) => ipcRenderer.invoke('settings:test-connection', payload),
  openApiKeyPage: (providerId) => ipcRenderer.invoke('settings:open-api-key-page', providerId),
  chooseOutputFolder: () => ipcRenderer.invoke('settings:choose-output-folder'),
  naverLogin: () => ipcRenderer.invoke('naver:login'),
  naverResetSession: () => ipcRenderer.invoke('naver:reset-session'),
  naverPublish: (payload) => ipcRenderer.invoke('naver:publish', payload),
  generateBatch: (payload) => ipcRenderer.invoke('pipeline:generate-batch', payload),
  cancelBatch: () => ipcRenderer.invoke('pipeline:cancel'),
  saveToFolder: (payload) => ipcRenderer.invoke('pipeline:save-to-folder', payload),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyOpenUrl: (url) => ipcRenderer.invoke('history:open-url', url),
  getUsedKeywords: () => ipcRenderer.invoke('history:get-used-keywords'),
  getPublishedKeywords: () => ipcRenderer.invoke('history:get-published-keywords'),
  recommendKeyword: () => ipcRenderer.invoke('keyword:recommend'),
  onPipelineProgress: (callback) => {
    // 글·이미지 생성과 자동발행 대기 상태를 화면에 실시간으로 알린다.
    // 반환값을 호출하면 리스너를 제거해 화면을 다시 열었을 때 중복 수신을 막을 수 있다.
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },
});
