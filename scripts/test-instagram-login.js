/**
 * 개발자가 인스타그램 로그인 세션만 따로 확인할 때 사용하는 수동 진단 스크립트다.
 * 실행하면 실제 로그인 창이 열릴 수 있으므로 자동 회귀 테스트에는 포함하지 않는다.
 */
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

const temporaryUserData = path.join(app.getPath('temp'), `autom-instagram-login-qa-${process.pid}`);
app.setPath('userData', temporaryUserData);

const instagramSession = require('../backend/features/instagram/session');

app.whenReady().then(async () => {
  const resultPath = path.join(process.cwd(), 'logs', 'instagram-login-qa.json');
  try {
    const result = await instagramSession.login({ timeoutMs: 3000 });
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify({ loginPageOpened: true, loggedIn: result.loggedIn }), 'utf8');
    console.log(JSON.stringify({ loginPageOpened: true, loggedIn: result.loggedIn }));
  } catch (error) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify({ loginPageOpened: false, error: error.message }), 'utf8');
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    instagramSession.resetSession();
    app.quit();
  }
});
