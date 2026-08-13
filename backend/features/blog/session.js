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
 * ★ 이 파일에서 가장 중요한 개념: '지속 쿠키'와 '세션 쿠키'
 *   - 지속 쿠키: 만료 날짜가 있어 파일로 저장됩니다. 브라우저를 껐다 켜도 로그인이 유지됩니다.
 *   - 세션 쿠키: 만료 날짜가 없어 메모리에만 있습니다. 창을 닫는 순간 사라집니다.
 *   이 프로그램은 로그인할 때와 발행할 때 브라우저를 각각 새로 열기 때문에,
 *   반드시 '지속 쿠키'를 받아야 합니다. 그래서 네이버 로그인 화면의
 *   "로그인 상태 유지"를 켠 상태로 로그인해야 하고, 로그인이 끝나면
 *   실제로 지속 쿠키가 저장됐는지 확인까지 해야 합니다.
 *   (이 확인을 하지 않으면 "로그인 성공"이라고 표시해 놓고 발행 때 로그인이 풀립니다.)
 *
 * 용어:
 * - Playwright : 브라우저를 프로그램이 대신 조작하게 해주는 자동화 도구
 * - Chromium   : 크롬의 기반이 되는 브라우저. 이 프로그램에 함께 들어 있습니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { chromium } = require('playwright');

// 네이버가 로그인 여부를 판단할 때 쓰는 인증 쿠키 이름이다.
// 이 중 하나라도 '지속 쿠키'로 저장되어 있어야 브라우저를 새로 열어도 로그인이 유지된다.
//
// 왜 "하나라도"인가요?
// 2026-08-13 실제 정상 동작 중인 프로필을 확인한 결과, NID_SES만 지속 쿠키로 저장되어 있고
// NID_AUT는 없는 상태로도 발행이 정상 동작했습니다. 둘 다 요구하면 멀쩡한 사용자의 작업을
// 잘못 막게 되므로, 하나라도 있으면 로그인이 유지되는 것으로 봅니다.
//
// NID_JST와 nid_slevel은 로그인 여부와 무관하게 존재하므로 판단 근거로 쓰지 않습니다.
const NAVER_AUTH_COOKIE_NAMES = ['NID_AUT', 'NID_SES'];
const NAVER_COOKIE_DOMAIN = 'naver.com';

// 로그인 화면에서 "로그인 상태 유지"를 켜는 데 쓰는 요소들이다.
// 실제 체크박스(input#nvlong)는 화면 밖에 숨겨져 있고 클릭을 받는 것은 부모 div#keep 이다.
// (2026-07-08 실제 로그인 페이지에서 확인)
const KEEP_LOGIN_TOGGLE = '#keep';
const KEEP_LOGIN_INPUT = '#nvlong';

// 네이버 페이지는 무거워서 느린 PC에서는 로딩이 오래 걸린다.
// 'domcontentloaded'는 글자와 구조가 준비된 시점으로, 광고·이미지까지 전부 기다리는
// 'load'보다 훨씬 빨리 도달한다. 로그인 여부 판단에는 이것으로 충분하다.
const PAGE_READY_STATE = 'domcontentloaded';
const NAVIGATION_TIMEOUT_MS = 45000;

// 네이버 로그인 쿠키를 사용자별 프로필 폴더에 보관한다.
// 글을 발행할 때마다 새 로그인 과정을 반복하지 않도록 Chromium이 이 폴더를 계속 사용한다.
function getProfileDir() {
  return path.join(app.getPath('userData'), 'naver-profile');
}

/**
 * 로그인 상태가 유지되는 브라우저를 연다.
 * 'persistent(지속)'는 창을 닫아도 로그인 정보가 폴더에 남는다는 뜻이다.
 *
 * headless를 true로 주면 화면 없이 조용히 실행된다.
 * 사람이 볼 필요가 없는 작업(저장된 쿠키만 읽기)에만 사용한다.
 */
async function launchPersistentContext({ headless = false } = {}) {
  return chromium.launchPersistentContext(getProfileDir(), {
    headless,
    viewport: { width: 1280, height: 900 },
    // 화면 없이 실행할 때는 설치본에 함께 넣어 둔 Chromium을 직접 지정해야 한다.
    // 지정하지 않으면 Playwright가 별도의 'headless shell'을 찾는데, 그 파일은
    // 설치 파일에 포함되어 있지 않아 사용자 PC에서 실행에 실패한다.
    ...(headless ? { executablePath: chromium.executablePath() } : {}),
  });
}

/**
 * 저장된 쿠키 중 네이버 로그인용 '지속 쿠키'가 살아 있는지 살펴본다.
 *
 * 반환값:
 *  - durable    : 인증 쿠키가 하나 이상 만료 날짜를 갖고 저장되어 있음 (정상)
 *  - sessionOnly: 인증 쿠키가 있긴 하지만 전부 만료 날짜가 없음
 *                 → 창을 닫으면 사라진다. "로그인 상태 유지"가 꺼진 채 로그인한 경우다.
 *  - missing    : 인증 쿠키가 아예 없음 (로그인한 적 없거나 로그인이 저장되지 않음)
 *  - found      : 확인된 지속 쿠키 이름 (문제 추적용)
 *
 * Playwright는 세션 쿠키의 expires를 -1로 알려준다. 이 값으로 지속/세션을 구분한다.
 */
async function inspectStoredLoginCookies(context) {
  const cookies = await context.cookies().catch(() => []);
  const authCookies = cookies.filter(
    (cookie) =>
      NAVER_AUTH_COOKIE_NAMES.includes(cookie.name) &&
      cookie.value &&
      String(cookie.domain || '').includes(NAVER_COOKIE_DOMAIN)
  );
  const durableCookies = authCookies.filter(
    (cookie) => Number.isFinite(cookie.expires) && cookie.expires > 0
  );

  return {
    durable: durableCookies.length > 0,
    sessionOnly: durableCookies.length === 0 && authCookies.length > 0,
    missing: authCookies.length === 0,
    found: durableCookies.map((cookie) => cookie.name),
  };
}

/**
 * 브라우저를 새로 열지 않고, 저장된 로그인 쿠키만 빠르게 확인한다.
 *
 * 왜 필요한가요?
 * 완전자동 발행은 글과 이미지를 먼저 만드는데 여기에 실제 AI 요금이 듭니다.
 * 다 만든 뒤에 "로그인이 안 되어 있습니다"를 알게 되면 그 비용이 전부 낭비됩니다.
 * 그래서 생성을 시작하기 전에 이 함수로 미리 확인합니다.
 *
 * 네이버에 접속하지 않고 저장된 쿠키만 보기 때문에 빠르고, 네트워크 상태와도 무관합니다.
 */
async function hasDurableLogin() {
  if (!fs.existsSync(getProfileDir())) {
    // 로그인을 한 번도 하지 않아 프로필 폴더 자체가 없는 상태다.
    return { durable: false, sessionOnly: false, missing: true, found: [] };
  }

  let context;
  try {
    context = await launchPersistentContext({ headless: true });
    return await inspectStoredLoginCookies(context);
  } catch (err) {
    // 확인 자체가 불가능하면 '로그인 없음'으로 단정하지 않는다.
    // 잘못 단정하면 정상적인 사용자의 작업까지 막게 되므로, 판단을 보류하고 진행시킨다.
    return { durable: false, unknown: true, message: err.message };
  } finally {
    await context?.close().catch(() => {});
  }
}

/**
 * 지금 로그인되어 있는지 확인한다.
 *
 * 결과는 세 가지로 구분한다. 이 구분이 중요한 이유는,
 * '네트워크가 느려서 확인을 못 한 것'과 '실제로 로그아웃된 것'은 해결 방법이 다르기 때문이다.
 * (예전에는 둘 다 "로그인이 필요합니다"로 안내해, 로그인이 멀쩡한데도 다시 로그인하게 만들었다.)
 *
 *  - 'logged-in'  : 로그인되어 있음
 *  - 'logged-out' : 실제로 로그인이 풀림 → 다시 로그인해야 함
 *  - 'unknown'    : 네트워크 오류나 응답 지연으로 확인 실패 → 잠시 후 재시도
 *
 * 확인 순서:
 *  1) 저장된 지속 쿠키가 아예 없으면 접속해 볼 필요도 없이 'logged-out'
 *  2) 쿠키가 있으면 로그인해야만 열리는 글쓰기 페이지에 들어가 본다
 *     - 로그인 페이지(nid.naver.com)로 튕기면 'logged-out'
 *     - 정상적으로 열리면 'logged-in'
 *     - 접속 자체가 실패하면 한 번 더 시도하고, 그래도 안 되면 'unknown'
 */
async function checkLoginStatus(context, blogId) {
  const stored = await inspectStoredLoginCookies(context);
  if (stored.missing) {
    return {
      state: 'logged-out',
      message: '저장된 네이버 로그인 정보가 없습니다. 설정에서 네이버 로그인을 해주세요.',
    };
  }
  if (stored.sessionOnly) {
    return {
      state: 'logged-out',
      message:
        '네이버 로그인이 이 브라우저에만 임시로 저장되어 유지되지 않았습니다. ' +
        '설정에서 다시 로그인할 때 "로그인 상태 유지"를 켠 채로 로그인해주세요.',
    };
  }

  const target = blogId ? `https://blog.naver.com/${blogId}?Redirect=Write&` : 'https://www.naver.com';
  let lastError;

  // 일시적인 응답 지연 때문에 로그인이 풀린 것으로 오해하지 않도록 두 번까지 시도한다.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const page = await context.newPage();
    try {
      await page.goto(target, { waitUntil: PAGE_READY_STATE, timeout: NAVIGATION_TIMEOUT_MS });
      const redirectedToLogin = page.url().includes('nid.naver.com');
      return redirectedToLogin
        ? { state: 'logged-out', message: '네이버 로그인이 만료되었습니다. 설정에서 다시 로그인해주세요.' }
        : { state: 'logged-in' };
    } catch (err) {
      lastError = err;
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    state: 'unknown',
    message: `네이버 접속을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요. (${lastError?.message || '응답 없음'})`,
  };
}

/** 예전 방식으로 참/거짓만 필요한 곳을 위한 간단한 형태다. */
async function isLoggedIn(context, blogId) {
  const result = await checkLoginStatus(context, blogId);
  return result.state === 'logged-in';
}

/**
 * 로그인 화면의 "로그인 상태 유지"를 확실히 켠다.
 *
 * 왜 이렇게까지 하나요?
 * 이 항목이 꺼진 채로 로그인하면 네이버가 '세션 쿠키'만 발급합니다.
 * 그러면 로그인 창을 닫는 순간 로그인이 사라져서, 나중에 발행할 때
 * "로그인이 풀렸다"는 증상이 나타납니다.
 * 예전에는 한 번 클릭해 보고 실패하면 그냥 넘어갔는데, 화면이 늦게 그려지는 PC에서는
 * 이 클릭이 자주 실패했습니다. 그래서 지금은 요소가 준비될 때까지 기다리고,
 * 켜졌는지 실제로 확인하고, 안 되면 다시 시도합니다.
 *
 * 반환값: 켜진 것을 확인했으면 true. 끝내 확인하지 못하면 false
 *         (이때는 사용자가 화면에서 직접 켤 수 있도록 안내한다).
 */
async function ensureKeepLoginChecked(page, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const toggle = page.locator(KEEP_LOGIN_TOGGLE);
      await toggle.waitFor({ state: 'visible', timeout: 10000 });

      // 숨겨진 진짜 체크박스의 상태가 사실이다. 이미 켜져 있으면 다시 누르지 않는다.
      // (다시 누르면 오히려 꺼진다.)
      const input = page.locator(KEEP_LOGIN_INPUT);
      if (await input.isChecked().catch(() => false)) {
        return true;
      }

      await toggle.click({ timeout: 5000 });
      if (await input.isChecked().catch(() => false)) {
        return true;
      }
      // 클릭은 됐지만 상태를 읽지 못하는 경우를 대비해 화면 표시로 한 번 더 확인한다.
      if ((await toggle.getAttribute('aria-checked').catch(() => null)) === 'true') {
        return true;
      }
    } catch (err) {
      // 아직 화면이 준비되지 않았을 수 있으므로 잠시 뒤 다시 시도한다.
    }
    await page.waitForTimeout(700);
  }
  return false;
}

/**
 * 로그인 창을 띄우고, 사용자가 로그인을 마칠 때까지 기다린다.
 *
 * 동작:
 *  1) 네이버 로그인 페이지를 브라우저 창으로 연다.
 *  2) "로그인 상태 유지"를 확실히 켠다. (실패하면 결과에 표시해 사용자에게 안내한다)
 *  3) 1초마다 주소를 확인하며 로그인 완료를 기다린다 (최대 5분).
 *  4) 로그인이 끝나면 지속 쿠키가 실제로 저장됐는지 확인한다.
 *     여기서 확인하지 않으면 "성공"이라고 저장해 놓고 발행 때 로그인이 풀린다.
 *  5) 창을 자동으로 닫는다. 사용자가 먼저 창을 닫으면 로그인 실패로 처리한다.
 *
 * 캡차나 휴대폰 인증이 나와도 사용자가 직접 처리하면 되므로 문제가 없다.
 *
 * 반환값: { loggedIn, durable, keepChecked, message }
 *  - loggedIn   : 로그인 화면을 벗어났는지
 *  - durable    : 브라우저를 껐다 켜도 유지되는 로그인인지 (이 값이 true여야 발행이 된다)
 *  - keepChecked: "로그인 상태 유지"를 켠 것을 확인했는지
 */
async function login() {
  const context = await launchPersistentContext();
  let closedByUser = false;
  context.on('close', () => {
    closedByUser = true;
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://nid.naver.com/nidlogin.login', {
      waitUntil: PAGE_READY_STATE,
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    const keepChecked = await ensureKeepLoginChecked(page);

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

    if (!loggedIn) {
      return {
        loggedIn: false,
        durable: false,
        keepChecked,
        message: '로그인 창이 닫혔거나 제한 시간 안에 로그인이 완료되지 않았습니다.',
      };
    }

    // 네이버가 쿠키를 기록할 시간을 잠시 준 뒤 실제 저장 상태를 확인한다.
    await page.waitForTimeout(1500);
    const stored = closedByUser
      ? { durable: false, sessionOnly: false, missing: [] }
      : await inspectStoredLoginCookies(context);

    if (stored.durable) {
      return { loggedIn: true, durable: true, keepChecked, message: '네이버 로그인에 성공했습니다.' };
    }

    // 로그인 자체는 됐지만 유지되지 않는 상태다. 원인에 맞는 해결 방법을 알려 준다.
    return {
      loggedIn: true,
      durable: false,
      keepChecked,
      message: keepChecked
        ? '로그인은 되었지만 로그인 상태가 저장되지 않았습니다. 네이버에서 기기 인증을 요구했는지 확인한 뒤 다시 로그인해주세요.'
        : '로그인 화면의 "로그인 상태 유지"가 켜지지 않아 로그인이 유지되지 않습니다. 다시 로그인할 때 이 항목을 직접 켠 뒤 진행해주세요.',
    };
  } finally {
    if (!closedByUser) {
      await context.close().catch(() => {});
    }
  }
}

function resetSession() {
  // 로그아웃하거나 다른 계정으로 바꿀 때, 저장된 로그인 쿠키 폴더를 지운다.
  const dir = getProfileDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  getProfileDir,
  launchPersistentContext,
  checkLoginStatus,
  isLoggedIn,
  hasDurableLogin,
  login,
  resetSession,
  _test: {
    inspectStoredLoginCookies,
    ensureKeepLoginChecked,
    NAVER_AUTH_COOKIE_NAMES,
    KEEP_LOGIN_TOGGLE,
    KEEP_LOGIN_INPUT,
  },
};
