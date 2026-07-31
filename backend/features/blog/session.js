/**
 * 네이버 로그인 브라우저와 사용자 세션 폴더를 관리한다.
 * 아이디와 비밀번호를 코드에 저장하지 않고 Chromium의 로그인 상태만 재사용한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { chromium } = require('playwright');

// 네이버 로그인 쿠키를 사용자별 프로필 폴더에 보관한다.
// 글을 발행할 때마다 새 로그인 과정을 반복하지 않도록 Chromium이 이 폴더를 계속 사용한다.
function getProfileDir() {
  return path.join(app.getPath('userData'), 'naver-profile');
}

async function launchPersistentContext() {
  // headless: false는 실제 로그인/발행 과정을 사용자가 볼 수 있는 브라우저 창으로 연다는 뜻이다.
  return chromium.launchPersistentContext(getProfileDir(), {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
}

/**
 * 실제로 로그인이 필요한 페이지(블로그 글쓰기)에 접근해 리다이렉트 여부로 로그인 상태를 판단한다.
 * 쿠키 이름은 네이버 쪽에서 자주 바뀌므로(2026-07-08 확인 시 NID_JST는 로그인 여부와 무관하게
 * 항상 존재해 신뢰할 수 없었다) 신뢰하지 않는다.
 */
async function isLoggedIn(context, blogId) {
  const page = await context.newPage();
  try {
    const target = blogId
      ? `https://blog.naver.com/${blogId}?Redirect=Write&`
      : 'https://www.naver.com';
    await page.goto(target, { waitUntil: 'load', timeout: 15000 });
    return !page.url().includes('nid.naver.com');
  } catch (err) {
    return false;
  } finally {
    await page.close();
  }
}

/**
 * persistent context 창을 띄워 사용자가 직접 로그인(캡차·기기확인 포함)하게 하고,
 * 로그인 완료(= nid.naver.com 밖으로 리다이렉트)가 감지되면 자동으로 창을 닫는다.
 */
async function login() {
  const context = await launchPersistentContext();
  let closedByUser = false;
  context.on('close', () => {
    closedByUser = true;
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://nid.naver.com/nidlogin.login');

  // "로그인 상태 유지"를 미리 체크해두지 않으면 로그인 쿠키가 세션 쿠키로만 발급되어
  // 브라우저를 껐다 켜면(=매 발행 시 새로 여는 persistent context) 로그인이 풀린다.
  // 2026-07-08 실제 로그인 페이지 확인: 실제 체크박스(input#nvlong)는 화면 밖에 숨겨져 있고,
  // 클릭을 처리하는 요소는 부모 div#keep (role="checkbox") 이다.
  try {
    await page.locator('#keep').click({ timeout: 5000 });
  } catch (err) {
    // 체크박스를 못 찾아도 로그인 자체는 계속 진행한다.
  }

  // 로그인 성공 시 네이버가 nid.naver.com 밖으로 리다이렉트하는 것을 감지한다.
  const deadline = Date.now() + 5 * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline && !closedByUser) {
    if (!page.url().includes('nid.naver.com')) {
      loggedIn = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!closedByUser) {
    await context.close().catch(() => {});
  }

  return loggedIn;
}

function resetSession() {
  // 로그아웃하거나 다른 계정으로 바꿀 때, 저장된 로그인 쿠키 폴더를 지운다.
  const dir = getProfileDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { getProfileDir, launchPersistentContext, isLoggedIn, login, resetSession };
