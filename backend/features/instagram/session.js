/**
 * [인스타그램 로그인 관리]
 *
 * 비개발자를 위한 설명:
 * - 네이버와 마찬가지로 아이디·비밀번호를 저장하지 않습니다.
 *   브라우저 창을 띄워 사용자가 직접 로그인하게 하고, 그 결과(쿠키)만 전용 폴더에 보관합니다.
 * - 네이버와 다른 점: 인스타그램은 로그인 여부를 'sessionid'라는 쿠키 하나로 확실히 알 수 있어,
 *   페이지에 들어가 보지 않고 쿠키만 확인해도 판단할 수 있습니다.
 * - 저장 폴더는 네이버(naver-profile)와 완전히 분리된 instagram-profile 입니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { chromium } = require('playwright');

/** 인스타그램 로그인 정보를 보관하는 전용 폴더 위치 */
function getProfileDir() {
  return path.join(app.getPath('userData'), 'instagram-profile');
}

/**
 * 로그인 상태가 유지되는 브라우저를 연다.
 * 한국어(ko-KR)로 설정하는 이유: 인스타그램 화면의 버튼 이름('만들기', '공유하기')을
 * 한국어 기준으로 찾도록 만들어 두었기 때문에, 언어가 다르면 버튼을 못 찾는다.
 */
async function launchPersistentContext() {
  return chromium.launchPersistentContext(getProfileDir(), {
    headless: false, // 사용자가 직접 로그인해야 하므로 창을 보이게 연다
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
    args: ['--lang=ko-KR'],
  });
}

/** 로그인 여부 확인: 'sessionid' 쿠키가 있으면 로그인된 상태다. */
async function isLoggedIn(context) {
  const cookies = await context.cookies('https://www.instagram.com');
  return cookies.some((cookie) => cookie.name === 'sessionid' && Boolean(cookie.value));
}

/**
 * 로그인한 계정의 아이디(@뒤에 오는 이름)를 알아낸다.
 * 화면 왼쪽 메뉴의 내 프로필 링크 주소에서 아이디를 뽑아내는 방식이다.
 * 메뉴가 축소되어 아이콘만 보이는 경우까지 고려해 두 가지 방법으로 찾는다.
 */
async function findUsername(page) {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const href = await page.evaluate(() => {
      // 글자가 보이는 넓은 메뉴와 아이콘만 보이는 축소 메뉴를 모두 처리한다.
      const images = Array.from(document.querySelectorAll('img'));
      const profileImage = images.find((image) => /프로필 사진|profile picture/i.test(image.getAttribute('alt') || ''));
      const imageHref = profileImage?.closest('a')?.getAttribute('href') || '';
      if (/^\/[^/?#]+\/?$/.test(imageHref)) return imageHref;

      const reservedPrefixes = [
        '/',
        '/reels/',
        '/direct/',
        '/explore/',
        '/accounts/',
        '/legal/',
        '/popular/',
        '/web/',
      ];
      const profileLink = Array.from(document.querySelectorAll('a[href]')).find((link) => {
        const candidate = link.getAttribute('href') || '';
        if (!/^\/[^/?#]+\/?$/.test(candidate)) return false;
        return !reservedPrefixes.some((reserved) =>
          reserved === '/' ? candidate === reserved : candidate.startsWith(reserved)
        );
      });
      return profileLink?.getAttribute('href') || '';
    });
    const match = href.match(/^\/([^/?#]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (error) {
    return '';
  }
}

/**
 * 로그인 창을 띄우고 사용자가 로그인을 마칠 때까지 최대 5분 기다린다.
 * 이미 로그인되어 있으면 바로 계정 이름만 확인하고 끝낸다.
 */
async function login({ timeoutMs = 5 * 60 * 1000 } = {}) {
  const context = await launchPersistentContext();
  let closedByUser = false;
  context.on('close', () => {
    closedByUser = true;
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    if (await isLoggedIn(context)) {
      return { loggedIn: true, username: await findUsername(page) };
    }

    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !closedByUser) {
      if (await isLoggedIn(context)) {
        return { loggedIn: true, username: await findUsername(page) };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { loggedIn: false, username: '' };
  } finally {
    if (!closedByUser) {
      await context.close().catch(() => {});
    }
  }
}

/** 저장된 로그인 정보를 통째로 삭제한다. (계정 변경이나 로그인 오류 해결 시 사용) */
function resetSession() {
  const profileDir = getProfileDir();
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

module.exports = { getProfileDir, launchPersistentContext, isLoggedIn, findUsername, login, resetSession };
