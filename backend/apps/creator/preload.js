const { contextBridge, ipcRenderer } = require('electron');

// Creator 화면에는 필요한 명령만 공개한다. 화면 코드가 파일이나 운영체제 권한에 직접 닿지 않는다.
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
  instagramSessionStatus: () => ipcRenderer.invoke('instagram:session-status'),
  instagramLogin: () => ipcRenderer.invoke('instagram:login'),
  instagramResetSession: () => ipcRenderer.invoke('instagram:reset-session'),
  generateInstagramCarousel: (payload) => ipcRenderer.invoke('instagram:generate-carousel', payload),
  publishInstagramCarousel: (payload) => ipcRenderer.invoke('instagram:publish-carousel', payload),
  generateYoutubeProject: (payload) => ipcRenderer.invoke('youtube:generate-project', payload),
  openYoutubeOutput: (outputPath) => ipcRenderer.invoke('youtube:open-output', outputPath),
  openCapcutEditor: () => ipcRenderer.invoke('youtube:open-capcut'),
  openYoutubeUploadPage: () => ipcRenderer.invoke('youtube:open-upload-page'),
  onPipelineProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },
  onInstagramProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('instagram:progress', listener);
    return () => ipcRenderer.removeListener('instagram:progress', listener);
  },
  onInstagramPublishProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('instagram:publish-progress', listener);
    return () => ipcRenderer.removeListener('instagram:publish-progress', listener);
  },
  onYoutubeProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  },
});
