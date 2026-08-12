/**
 * [네이버 로그인 관리]
 *
 * 비개발자를 위한 설명:
 * - 이 프로그램은 사용자의 네이버 아이디·비밀번호를 절대 저장하지 않습니다.
 * - 대신 '자동화용 브라우저' 창을 띄워 사용자가 직접 로그인하게 하고,
 *   로그인 후 브라우저에 남는 흔적(쿠키)만 전용 폴더에 보관합니다.
 *   → 실제 크롬에서 한 번 로그인하면 다음부터 자동 로그인되는 것과 같은 원리입니다.
 * - 덕분에 캡차나 2단계 인증도 사용자가 직접 처리할 수 있고,
 *   프로그램은 비밀번호를 알 필요가 없습니다.
 *
 * 용어:
 * - Playwright : 브라우저를 프로그램이 대신 조작하게 해주는 자동화 도구
 * - Chromium   : 크롬의 기반이 되는 브라우저. 이 프로그램에 함께 들어 있습니다.
 * - 세션/쿠키   : 로그인 상태를 기억하는 데이터
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

/**
 * 로그인 상태가 유지되는 브라우저를 연다.
 * 'persistent(지속)'는 창을 닫아도 로그인 정보가 폴더에 남는다는 뜻이다.
 */
async function launchPersistentContext() {
  // headless: false는 실제 로그인/발행 과정을 사용자가 볼 수 있는 브라우저 창으로 연다는 뜻이다.
  // (headless: true였다면 화면 없이 뒤에서 조용히 실행되어, 사용자가 로그인할 수 없다)
  return chromium.launchPersistentContext(getProfileDir(), {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
}

/**
 * 지금 로그인되어 있는지 확인한다.
 *
 * 확인 방법: 로그인해야만 볼 수 있는 '글쓰기' 페이지에 들어가 본다.
 *  - 그대로 열리면 → 로그인 상태
 *  - 로그인 페이지(nid.naver.com)로 튕겨나가면 → 로그아웃 상태
 *
 * 왜 쿠키를 직접 확인하지 않나요?
 * 쿠키 이름은 네이버 쪽에서 자주 바뀌므로(2026-07-08 확인 시 NID_JST는 로그인 여부와 무관하게
 * 항상 존재해 신뢰할 수 없었다) 신뢰하지 않는다. 실제로 들어가 보는 방식이 가장 확실하다.
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
 * 로그인 창을 띄우고, 사용자가 로그인을 마칠 때까지 기다린다.
 *
 * 동작:
 *  1) 네이버 로그인 페이지를 브라우저 창으로 연다.
 *  2) '로그인 상태 유지' 체크박스를 미리 켠다.
 *  3) 1초마다 주소를 확인하며 로그인 완료를 기다린다 (최대 5분).
 *  4) 완료되면 창을 자동으로 닫는다. 사용자가 먼저 창을 닫으면 로그인 실패로 처리한다.
 *
 * 캡차나 휴대폰 인증이 나와도 사용자가 직접 처리하면 되므로 문제가 없다.
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
