/**
 * 인스타그램 로그인 브라우저와 사용자 세션 폴더를 관리한다.
 * 로그인 과정은 사용자가 직접 진행하며 프로그램은 브라우저 상태만 보관한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { chromium } = require('playwright');

function getProfileDir() {
  return path.join(app.getPath('userData'), 'instagram-profile');
}

async function launchPersistentContext() {
  return chromium.launchPersistentContext(getProfileDir(), {
    headless: false,
    locale: 'ko-KR',
    viewport: { width: 1280, height: 900 },
    args: ['--lang=ko-KR'],
  });
}

async function isLoggedIn(context) {
  const cookies = await context.cookies('https://www.instagram.com');
  return cookies.some((cookie) => cookie.name === 'sessionid' && Boolean(cookie.value));
}

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

function resetSession() {
  const profileDir = getProfileDir();
  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

module.exports = { getProfileDir, launchPersistentContext, isLoggedIn, findUsername, login, resetSession };
