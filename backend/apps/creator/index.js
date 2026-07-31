/**
 * 블로그, 인스타그램, 유튜브 기능을 함께 제공하는 Creator 앱의 시작점이다.
 * 창과 보안 옵션을 만들고 공통 IPC 및 Creator 전용 IPC를 화면에 연결한다.
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

// 1번 블로그 앱과 설정, 발행 기록, 로그인 세션이 절대 섞이지 않도록 Creator만의 경로를 쓴다.
app.setName('AutoM Creator');
// 자동 UI 테스트는 실제 사용자 키·기록을 건드리지 않도록 개발 실행에서만 별도 경로를 허용한다.
// 설치된 프로그램은 환경변수를 무시하고 항상 정식 Creator AppData 폴더를 사용한다.
const qaUserDataPath = !app.isPackaged && process.env.AUTOM_CREATOR_USER_DATA_DIR;
app.setPath(
  'userData',
  qaUserDataPath ? path.resolve(qaUserDataPath) : path.join(app.getPath('appData'), 'marketing-app-creator')
);

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
}

const { registerIpcHandlers } = require('../../shared/ipc');
const { registerCreatorIpcHandlers } = require('./ipc');
const logger = require('../../shared/logger');

process.on('uncaughtException', (error) => {
  logger.error(`처리하지 못한 예외: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`처리하지 못한 Promise 오류: ${reason instanceof Error ? reason.message : String(reason)}`);
});

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', '..', '..', 'frontend', 'creator', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  // 기존 블로그 IPC를 재사용해 Blog 탭의 동작을 1번과 동일하게 유지한다.
  registerIpcHandlers(() => mainWindow);
  registerCreatorIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
