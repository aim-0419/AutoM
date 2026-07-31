/**
 * Electron 앱의 시작점이다.
 * 창을 만들고, 화면과 백엔드 기능을 연결하며, 설치된 앱에서도 자동화용 Chromium을 찾게 한다.
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

app.setName('AutoM');

// 실행 방식(electron ., 개발 환경의 index.js 직접 실행 등)에 따라 앱 이름 인식이 달라져
// userData 경로가 바뀌는 것을 방지하기 위해 항상 고정된 경로를 명시적으로 사용한다.
// 자동 UI 테스트에서는 운영 설정과 기록을 읽지 않도록 별도의 임시 경로를 사용할 수 있다.
const qaUserDataPath = !app.isPackaged && process.env.AUTOM_BLOG_USER_DATA_DIR;
app.setPath(
  'userData',
  qaUserDataPath ? path.resolve(qaUserDataPath) : path.join(app.getPath('appData'), 'marketing-app')
);

// 패키징된 앱은 electron-builder가 번들링한 Chromium을 쓰도록 경로를 지정한다.
// playwright 모듈이 로드되기 전에 설정해야 하므로 다른 require보다 앞에 둔다.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
}

const { registerIpcHandlers } = require('../../shared/ipc');
const logger = require('../../shared/logger');

process.on('uncaughtException', (err) => {
  logger.error(`처리되지 않은 예외: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`처리되지 않은 프로미스 거부: ${reason instanceof Error ? reason.message : String(reason)}`);
});

let mainWindow = null;

function createMainWindow() {
  // 사용자가 보는 프로그램 창이다. 화면 코드에는 필요한 기능만 preload.js를 통해 전달한다.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      // 화면과 내부 기능을 분리해, 화면에서 파일·운영체제 권한을 직접 쓰지 못하게 한다.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Electron이 기본으로 보여주는 File/Edit/View/Window 메뉴는 사용자 기능과 무관하므로 숨긴다.
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, '..', '..', '..', 'frontend', 'blog', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  logger.info('앱 시작');
  Menu.setApplicationMenu(null);
  registerIpcHandlers(() => mainWindow);
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
