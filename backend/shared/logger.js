/**
 * [기록장(로그) 담당]
 *
 * 비개발자를 위한 설명:
 * - 프로그램이 언제 무슨 일을 했는지, 어떤 오류가 났는지를 텍스트 파일(app.log)에 계속 적어둡니다.
 * - 사용자에게는 보이지 않지만, "어제 발행이 왜 실패했지?" 같은 문제를 나중에 확인할 때 사용합니다.
 * - 기록은 시간 순으로 한 줄씩 쌓이며 형식은 `[시각] [INFO/ERROR] 내용` 입니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * 기록 파일을 어디에 둘지 정한다.
 * - 개발 중: 프로젝트 안의 logs/ 폴더 (개발자가 바로 열어보기 편함)
 * - 설치본:  사용자 AppData 폴더 (설치 폴더는 쓰기가 막혀 있을 수 있어 저장이 실패함)
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
  info: (message) => writeLine('INFO', message), // 평상시 진행 상황 기록 (예: "앱 시작")
  error: (message) => writeLine('ERROR', message), // 문제 상황 기록 (예: "발행 실패: ...")
};
