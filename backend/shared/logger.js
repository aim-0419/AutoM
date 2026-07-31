const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * 개발 중에는 프로젝트의 logs/ 폴더를 그대로 쓰고, 패키징된 앱에서는 asar 안이 아닌
 * userData/logs 처럼 실제 쓰기 가능한 경로를 사용한다.
 */
function getLogsDir() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'logs');
  }
  return path.join(__dirname, '..', '..', 'logs');
}

function writeLine(level, message) {
  // 사용자 화면에 보이지 않는 기술 오류도 파일에 남겨, 문제가 생겼을 때 원인을 추적할 수 있게 한다.
  try {
    const logsDir = getLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(logsDir, 'app.log'), `[${timestamp}] [${level}] ${message}\n`, 'utf-8');
  } catch (err) {
    // 로그 기록 자체의 실패는 원래 작업을 막지 않도록 무시한다.
  }
}

module.exports = {
  getLogsDir,
  info: (message) => writeLine('INFO', message),
  error: (message) => writeLine('ERROR', message),
};
