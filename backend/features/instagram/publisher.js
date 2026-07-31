/**
 * 생성된 카드 이미지와 게시 문구를 인스타그램 웹 화면에 입력해 발행한다.
 * 로그인 상태와 브라우저 프로필은 session.js에서 가져온다.
 */
const fs = require('node:fs');
const path = require('node:path');
const session = require('./session');

const INSTAGRAM_HOME = 'https://www.instagram.com/';
const LOGIN_REQUIRED_MESSAGE = '인스타그램 로그인이 필요합니다. 인스타그램 탭에서 먼저 로그인해 주세요.';

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || buffer.length < 24) {
    throw new Error('인스타그램에는 정상적인 PNG 카드만 올릴 수 있습니다.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateCarouselContent(content) {
  const images = Array.isArray(content?.images) ? content.images : [];
  if (images.length < 2 || images.length > 10) {
    throw new Error('인스타그램 캐러셀은 이미지 2~10장이 필요합니다.');
  }

  for (const imagePath of images) {
    if (typeof imagePath !== 'string' || path.extname(imagePath).toLocaleLowerCase() !== '.png' || !fs.existsSync(imagePath)) {
      throw new Error('생성된 PNG 카드 파일을 찾을 수 없습니다.');
    }
    const { width, height } = readPngDimensions(imagePath);
    if (width !== 1080 || height !== 1350) {
      throw new Error('카드 이미지는 1080 x 1350 크기여야 합니다.');
    }
  }

  const caption = String(content?.caption || '').trim();
  if (!caption || [...caption].length > 2200) {
    throw new Error('인스타그램 캡션은 1~2,200자로 작성해 주세요.');
  }
  return { images: images.map((imagePath) => path.resolve(imagePath)), caption };
}

async function clickFirstVisible(locators, errorMessage, { timeoutMs = 0 } = {}) {
  // Instagram 메뉴는 로그인 직후 늦게 그려질 수 있으므로 지정된 시간 동안 다시 찾는다.
  const deadline = Date.now() + timeoutMs;
  do {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const item = locator.nth(index);
        if (await item.isVisible().catch(() => false)) {
          await item.click();
          return true;
        }
      }
    }
    if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);

  if (errorMessage) throw new Error(errorMessage);
  return false;
}

async function openCreateComposer(page) {
  await page.goto(INSTAGRAM_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);

  await clickFirstVisible(
    [
      page.getByRole('link', { name: /^(만들기|Create)$/i }),
      page.getByRole('button', { name: /^(만들기|Create)$/i }),
      page
        .locator(
          'svg[aria-label="새로운 게시물"], svg[aria-label="새 게시물"], svg[aria-label="New post"], svg[aria-label="Create"]'
        )
        .locator('xpath=..'),
      page.locator(
        'svg[aria-label="새로운 게시물"], svg[aria-label="새 게시물"], svg[aria-label="New post"], svg[aria-label="Create"]'
      ),
      page.getByText(/^(만들기|Create)$/i, { exact: true }),
    ],
    '인스타그램의 게시물 만들기 버튼을 찾지 못했습니다. 화면 구성이 변경되었을 수 있습니다.',
    { timeoutMs: 10000 }
  );

  await page.waitForTimeout(500);
  if ((await page.locator('input[type="file"]').count()) === 0) {
    await clickFirstVisible(
      [
        page.getByRole('button', { name: /^(게시물|Post)$/i }),
        page.getByText(/^(게시물|Post)$/i, { exact: true }),
      ],
      null
    );
  }

  const fileInput = page.locator('input[type="file"]').last();
  await fileInput.waitFor({ state: 'attached', timeout: 15000 });
  return fileInput;
}

async function findCaptionEditor(page) {
  const dialog = page.locator('div[role="dialog"]').last();
  const candidates = [
    dialog.locator('textarea[aria-label*="문구"], textarea[aria-label*="caption" i]'),
    dialog.locator('div[contenteditable="true"][role="textbox"]'),
    page.locator('textarea[aria-label*="문구"], textarea[aria-label*="caption" i]'),
  ];
  for (const candidate of candidates) {
    const count = await candidate.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      if (await candidate.nth(index).isVisible().catch(() => false)) return candidate.nth(index);
    }
  }
  return null;
}

async function moveToCaptionStep(page) {
  for (let step = 0; step < 3; step += 1) {
    const editor = await findCaptionEditor(page);
    if (editor) return editor;

    await clickFirstVisible(
      [
        page.getByRole('button', { name: /^(다음|Next)$/i }),
        page.getByText(/^(다음|Next)$/i, { exact: true }),
      ],
      '인스타그램 작성 화면의 다음 버튼을 찾지 못했습니다.'
    );
    await page.waitForTimeout(900);
  }

  const editor = await findCaptionEditor(page);
  if (!editor) throw new Error('인스타그램 캡션 입력 칸을 찾지 못했습니다.');
  return editor;
}

async function findLatestPostUrl(page, username) {
  if (!username) return null;
  try {
    await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const post = page.locator('a[href*="/p/"]').first();
    await post.waitFor({ state: 'visible', timeout: 10000 });
    const href = await post.getAttribute('href');
    if (!href) return null;
    // 계정별 화면은 /사용자명/p/ID/를 반환하기도 하므로 안전하게 열 수 있는 표준 주소로 맞춘다.
    const postId = href.match(/\/p\/([a-z0-9_-]+)/i)?.[1];
    return postId ? new URL(`/p/${postId}/`, INSTAGRAM_HOME).href : null;
  } catch (error) {
    return null;
  }
}

async function publish(content, { onProgress } = {}) {
  let context;
  try {
    const { images, caption } = validateCarouselContent(content);
    onProgress?.({ stage: 'opening' });
    context = await session.launchPersistentContext();
    if (!(await session.isLoggedIn(context))) {
      return { success: false, code: 'LOGIN_REQUIRED', message: LOGIN_REQUIRED_MESSAGE };
    }

    const page = context.pages()[0] || (await context.newPage());
    let username = String(content?.username || '').trim() || (await session.findUsername(page));
    const fileInput = await openCreateComposer(page);
    onProgress?.({ stage: 'uploading' });
    await fileInput.setInputFiles(images);
    await page.waitForTimeout(1200);

    const captionEditor = await moveToCaptionStep(page);
    onProgress?.({ stage: 'captioning' });
    await captionEditor.fill(caption);

    onProgress?.({ stage: 'publishing' });
    await clickFirstVisible(
      [
        page.getByRole('button', { name: /^(공유하기|Share)$/i }),
        page.getByText(/^(공유하기|Share)$/i, { exact: true }),
      ],
      '인스타그램 공유 버튼을 찾지 못했습니다.'
    );

    const successMessage = page.getByText(/게시물이 공유되었습니다|Your post has been shared/i).last();
    await successMessage.waitFor({ state: 'visible', timeout: 120000 });
    onProgress?.({ stage: 'verifying' });
    username = username || (await session.findUsername(page));
    const url = await findLatestPostUrl(page, username);
    onProgress?.({ stage: 'published' });
    return {
      success: true,
      url,
      username,
      message: url ? '인스타그램 캐러셀 발행이 완료되었습니다.' : '인스타그램 캐러셀 발행이 완료되었습니다. 게시물 주소는 프로필에서 확인해 주세요.',
    };
  } catch (error) {
    return { success: false, message: error.message || '인스타그램 발행 중 오류가 발생했습니다.' };
  } finally {
    await context?.close().catch(() => {});
  }
}

module.exports = {
  publish,
  _test: {
    readPngDimensions,
    validateCarouselContent,
    clickFirstVisible,
    openCreateComposer,
    findCaptionEditor,
    moveToCaptionStep,
    findLatestPostUrl,
  },
};
