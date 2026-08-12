/**
 * [인스타그램 자동 발행기]
 *
 * 비개발자를 위한 설명:
 * - 만들어 둔 카드 이미지들을 인스타그램에 자동으로 올립니다.
 *   네이버 발행기와 마찬가지로, 사람이 하던 클릭을 프로그램이 대신하는 방식입니다.
 *
 * - 발행 순서(진행 상황 표시와 동일):
 *     opening    → 브라우저를 열고 로그인 확인
 *     uploading  → '만들기' 버튼을 눌러 카드 이미지들을 업로드
 *     captioning → '다음'을 눌러 문구 입력 화면으로 이동한 뒤 본문 입력
 *     publishing → '공유하기' 버튼 클릭
 *     verifying  → "게시물이 공유되었습니다" 문구를 확인하고 게시물 주소를 찾음
 *     published  → 완료
 *
 * - 인스타그램 화면은 자주 바뀌고 언어에 따라 버튼 이름도 다릅니다.
 *   그래서 버튼을 찾을 때 여러 후보(한국어/영어, 글자/아이콘)를 순서대로 시도합니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const session = require('./session');

const INSTAGRAM_HOME = 'https://www.instagram.com/';
const LOGIN_REQUIRED_MESSAGE = '인스타그램 로그인이 필요합니다. 인스타그램 탭에서 먼저 로그인해 주세요.';

/**
 * PNG 파일의 가로·세로 크기를 읽는다.
 *
 * 어떻게 읽나요? PNG 파일은 맨 앞 8바이트에 "나는 PNG다"라는 고정된 표식이 있고,
 * 그 다음 위치(16번째, 20번째 바이트)에 가로·세로 값이 들어 있습니다.
 * 이 표식이 없으면 확장자만 .png인 가짜 파일이므로 발행을 거부합니다.
 */
function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || buffer.length < 24) {
    throw new Error('인스타그램에는 정상적인 PNG 카드만 올릴 수 있습니다.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * 발행 직전 최종 검사. 인스타그램 규격에 맞지 않으면 업로드를 시작조차 하지 않는다.
 *   · 이미지 2~10장 (인스타그램 여러 장 게시물 규격)
 *   · 모두 실제로 존재하는 정상 PNG 파일
 *   · 크기가 정확히 1080 x 1350 (우리가 만든 카드 규격)
 *   · 본문 글이 1~2,200자 (인스타그램 글자 수 제한)
 */
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

/**
 * 여러 후보 중 '화면에 실제로 보이는' 첫 번째 버튼을 눌러 준다.
 *
 * 왜 이렇게 하나요?
 * - 인스타그램은 화면 크기·언어·업데이트에 따라 버튼 모양이 달라집니다.
 *   ('만들기' 글자일 수도, '+' 아이콘일 수도, 영어 'Create'일 수도 있음)
 * - 그래서 가능한 후보들을 순서대로 넣어두고, 그중 보이는 것을 누릅니다.
 * - 화면이 아직 다 그려지지 않았을 수 있으므로 지정한 시간 동안 0.25초 간격으로 다시 찾습니다.
 */
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

/**
 * 인스타그램의 '새 게시물 만들기' 창을 열고, 파일을 넣을 자리를 찾아 돌려준다.
 * 계정 종류에 따라 '만들기' 다음에 '게시물'을 한 번 더 골라야 하는 경우도 처리한다.
 */
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

/**
 * 문구 입력 화면까지 '다음' 버튼을 눌러 이동한다.
 * 사진 자르기 → 필터 적용 → 문구 입력 순으로 최대 3단계를 거치므로,
 * 문구 입력칸이 나타날 때까지 최대 3번 '다음'을 누른다.
 */
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

/**
 * 방금 올린 게시물의 주소를 찾아온다.
 * 내 프로필 페이지로 가서 가장 첫 번째(= 가장 최근) 게시물의 링크를 읽는 방식이다.
 * 주소를 못 찾아도 발행 자체는 성공이므로, 실패 시에는 null만 돌려주고 넘어간다.
 */
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

/**
 * [메인 함수] 카드 이미지와 문구를 인스타그램에 실제로 올린다.
 *
 * 결과:
 *   성공 시 { success: true, url, username, message }
 *   로그인 필요 시 { success: false, code: 'LOGIN_REQUIRED', ... } — 호출한 쪽에서 로그인 안내를 띄운다
 *   그 외 실패 시 { success: false, message }
 *
 * 공유 버튼을 누른 뒤 "게시물이 공유되었습니다"라는 문구가 뜰 때까지 최대 2분 기다린다.
 * (사진 여러 장을 올리므로 인터넷 속도에 따라 시간이 걸릴 수 있다)
 */
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
