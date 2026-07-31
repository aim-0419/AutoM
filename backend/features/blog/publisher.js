/**
 * 완성된 글과 이미지를 네이버 스마트에디터에 입력하고 발행하는 자동화 모듈이다.
 * 화면 위치를 찾는 규칙은 selectors.js, 로그인 정보는 session.js가 맡는다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { clipboard } = require('electron');
const session = require('./session');
const selectors = require('./selectors');
const logger = require('../../shared/logger');
const { toLocalScheduleParts } = require('../../core/schedule');

/**
 * Playwright를 이용해 네이버 블로그 스마트에디터를 실제 브라우저처럼 조작하는 발행기다.
 * 제목, 본문, 이미지, 카테고리, 공개 설정, 태그를 입력한 뒤 게시물 URL로 이동했는지 확인한다.
 */
// 실제 에디터 폭을 읽지 못했을 때 쓰는 기본값이다. 기존 26자는 본문 폭의 절반 정도만 사용했다.
const DEFAULT_READABLE_LINE_MAX_CHARS = 42;
const MIN_READABLE_LINE_MAX_CHARS = 32;
const MAX_READABLE_LINE_MAX_CHARS = 52;
const READABLE_LINE_TARGET_RATIO = 0.9;

function randomDelay(min = 1000, max = 3000) {
  // 네이버 에디터 화면은 클릭 직후 바로 다음 요소가 준비되지 않을 때가 있다.
  // 사람이 천천히 조작하는 것처럼 잠깐 기다려서 입력/클릭 실패를 줄인다.
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveFailureArtifacts(page, stage) {
  // 발행 실패 시 그 순간의 화면 이미지와 HTML을 저장한다.
  // 네이버 화면 구조가 바뀌었는지, 로그인 문제가 있었는지 나중에 눈으로 확인하기 위해서다.
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logsDir = logger.getLogsDir();
    fs.mkdirSync(logsDir, { recursive: true });
    const base = path.join(logsDir, `naver-fail-${stage}-${timestamp}`);
    if (page) {
      await page.screenshot({ path: `${base}.png` }).catch(() => {});
      const html = await page.content().catch(() => null);
      if (html) {
        fs.writeFileSync(`${base}.html`, html);
      }
    }
  } catch (err) {
    // 로그 저장 자체의 실패는 무시한다 (원본 에러가 더 중요).
  }
}

function splitInlineBoldSegments(line) {
  // "**중요 문장**"처럼 굵게 표시할 부분과 일반 문장을 나눈다.
  const segments = [];
  const boldPattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = boldPattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), bold: false });
  }

  return segments.filter((segment) => segment.text);
}

function tokenizeSegments(segments) {
  // 굵게 표시 여부는 보존하면서, 문장을 어절과 공백 단위로 나눈다.
  // 이후 줄을 나눌 때 단어 중간이 아니라 공백에서만 끊기기 위한 준비다.
  const tokens = [];
  for (const segment of segments) {
    const parts = segment.text.split(/(\s+)/u).filter((part) => part.length > 0);
    for (const part of parts) {
      if (/^\s+$/u.test(part)) {
        if (tokens.length > 0 && !tokens[tokens.length - 1].space) {
          tokens.push({ text: ' ', bold: segment.bold, space: true });
        }
      } else {
        tokens.push({ text: part, bold: segment.bold, space: false });
      }
    }
  }
  return tokens;
}

function displayLength(text) {
  return Array.from(text).length;
}

function calculateReadableLineMaxChars(containerWidth, fontSize) {
  // 에디터 폭의 약 90%를 사용하되 너무 짧거나 긴 줄은 제한한다.
  // 한글 한 글자의 폭은 현재 글꼴 크기와 거의 비슷하므로 안전한 근삿값으로 사용할 수 있다.
  const width = Number(containerWidth);
  const size = Number(fontSize);
  if (!Number.isFinite(width) || !Number.isFinite(size) || width <= 0 || size <= 0) {
    return DEFAULT_READABLE_LINE_MAX_CHARS;
  }
  const estimated = Math.floor((width / size) * READABLE_LINE_TARGET_RATIO);
  return Math.min(MAX_READABLE_LINE_MAX_CHARS, Math.max(MIN_READABLE_LINE_MAX_CHARS, estimated));
}

async function getReadableLineMaxChars(editorFrame) {
  try {
    const metrics = await editorFrame.locator(selectors.bodyComponent).first().evaluate((element) => {
      const paragraph = element.querySelector('.se-text-paragraph') || element;
      const textSample = element.querySelector('.se-placeholder, [class*="se-fs"]') || paragraph;
      return {
        width: paragraph.getBoundingClientRect().width,
        fontSize: Number.parseFloat(getComputedStyle(textSample).fontSize),
      };
    });
    return calculateReadableLineMaxChars(metrics.width, metrics.fontSize);
  } catch (err) {
    return DEFAULT_READABLE_LINE_MAX_CHARS;
  }
}

function trimTrailingSpaces(tokens) {
  while (tokens.length > 0 && tokens[tokens.length - 1].space) {
    tokens.pop();
  }
}

function mergeTokensToSegments(tokens) {
  const segments = [];
  for (const token of tokens) {
    if (token.space && segments.length === 0) {
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && last.bold === token.bold) {
      last.text += token.text;
    } else {
      segments.push({ text: token.text, bold: token.bold });
    }
  }
  return segments.filter((segment) => segment.text.trim());
}

function segmentsToPlainText(segments) {
  return segments.map((segment) => segment.text).join('');
}

function isStandaloneUrlLine(line) {
  return /^https?:\/\/\S+$/i.test(String(line || '').trim());
}

function isPublishedPostUrl(value, blogId) {
  // 마지막 발행 버튼을 누른 뒤, 실제로 내 블로그의 게시물 주소로 이동했는지 확인한다.
  // 단순히 버튼 클릭이 성공했다는 것만으로는 발행 완료라고 판단하지 않는다.
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) {
      return false;
    }

    const directMatch = url.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    if (directMatch) {
      return directMatch[1].toLocaleLowerCase() === String(blogId || '').toLocaleLowerCase();
    }

    if (/\/PostView\.naver$/i.test(url.pathname)) {
      return (
        url.searchParams.get('blogId')?.toLocaleLowerCase() === String(blogId || '').toLocaleLowerCase() &&
        /^\d+$/.test(url.searchParams.get('logNo') || '')
      );
    }
    return false;
  } catch (err) {
    return false;
  }
}

function extractCompletedPostUrl(value, blogId) {
  try {
    const url = value instanceof URL ? value : new URL(String(value || ''));
    if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) {
      return null;
    }

    const directMatch = url.pathname.match(/^\/([^/]+)\/(\d+)\/?$/);
    if (directMatch && directMatch[1].toLocaleLowerCase() === String(blogId || '').toLocaleLowerCase()) {
      return `https://blog.naver.com/${directMatch[1]}/${directMatch[2]}`;
    }

    if (/\/PostView\.naver$/i.test(url.pathname)) {
      const targetBlogId = url.searchParams.get('blogId') || '';
      const logNo = url.searchParams.get('logNo') || '';
      if (targetBlogId.toLocaleLowerCase() === String(blogId || '').toLocaleLowerCase() && /^\d+$/.test(logNo)) {
        return `https://blog.naver.com/${targetBlogId}/${logNo}`;
      }
    }

    // 예약발행은 공개 글 화면으로 바로 이동하지 않고 PostList 프레임에 새 logNo를 돌려준다.
    if (/\/PostList\.naver$/i.test(url.pathname) && url.searchParams.get('isAfterWrite') === 'true') {
      const targetBlogId = url.searchParams.get('blogId') || '';
      const logNo = url.searchParams.get('logNo') || '';
      if (targetBlogId.toLocaleLowerCase() === String(blogId || '').toLocaleLowerCase() && /^\d+$/.test(logNo)) {
        return `https://blog.naver.com/${targetBlogId}/${logNo}`;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function waitForPublishCompletion(page, blogId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidateUrls = [page.url(), ...page.frames().map((frame) => frame.url())];
    for (const candidate of candidateUrls) {
      const completedUrl = extractCompletedPostUrl(candidate, blogId);
      if (completedUrl) {
        return completedUrl;
      }
    }
    await page.waitForTimeout(300);
  }
  throw new Error('네이버가 새 게시물 번호를 반환하지 않아 발행 완료를 확인할 수 없습니다.');
}

async function configureScheduledPublish(editorFrame, page, scheduleAt) {
  const scheduleDate = new Date(scheduleAt);
  if (Number.isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= Date.now() + 2 * 60 * 1000) {
    throw new Error('예약 시각이 너무 가까워졌습니다. 현재보다 여유 있는 시간으로 다시 설정해주세요.');
  }

  const parts = toLocalScheduleParts(scheduleDate);
  await editorFrame.locator(selectors.publishTimeRadio.scheduled).click();
  const scheduledInput = editorFrame.locator(selectors.scheduledTimeInput);
  if (!(await scheduledInput.isChecked())) {
    throw new Error('네이버 예약발행 선택이 적용되지 않았습니다.');
  }

  const dateInput = editorFrame.locator(selectors.scheduleDateInput);
  await dateInput.click();
  const calendar = editorFrame.locator(selectors.scheduleCalendar);
  await calendar.waitFor({ state: 'visible', timeout: 5000 });

  const targetMonthKey = parts.year * 12 + parts.month;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const displayedYear = Number(await calendar.locator(selectors.scheduleCalendarYear).textContent());
    const displayedMonth = Number(
      String(await calendar.locator(selectors.scheduleCalendarMonth).textContent()).replace(/\D/g, '')
    );
    const displayedMonthKey = displayedYear * 12 + displayedMonth;
    if (displayedMonthKey === targetMonthKey) {
      break;
    }
    if (displayedMonthKey > targetMonthKey || attempt === 12) {
      throw new Error('네이버 예약 달력에서 선택한 날짜를 찾지 못했습니다.');
    }
    await calendar.locator(selectors.scheduleCalendarNext).click();
    await page.waitForTimeout(150);
  }

  const dayButton = calendar
    .locator(selectors.scheduleCalendarDayButtons)
    .filter({ hasText: new RegExp(`^${parts.day}$`) });
  if ((await dayButton.count()) !== 1) {
    throw new Error('네이버 예약 달력에서 선택한 날짜를 정확히 찾지 못했습니다.');
  }
  await dayButton.click();
  await editorFrame.locator(selectors.scheduleHourSelect).selectOption(parts.hour);
  await editorFrame.locator(selectors.scheduleMinuteSelect).selectOption(parts.minute);

  const appliedDate = String(await dateInput.inputValue()).replace(/\s+/g, ' ').trim();
  const appliedHour = await editorFrame.locator(selectors.scheduleHourSelect).inputValue();
  const appliedMinute = await editorFrame.locator(selectors.scheduleMinuteSelect).inputValue();
  if (appliedDate !== parts.dateLabel || appliedHour !== parts.hour || appliedMinute !== parts.minute) {
    throw new Error('선택한 예약 날짜와 시간이 네이버 발행 설정에 정확히 적용되지 않았습니다.');
  }
  return parts;
}

function wrapLineForReadablePublishing(line, maxChars = DEFAULT_READABLE_LINE_MAX_CHARS) {
  // 긴 한글 문장을 그대로 넣으면 네이버 화면에서 글자 중간에 줄이 바뀔 수 있다.
  // 그래서 실제 에디터 폭에 맞춰 어절 단위로 줄을 만들어 단어가 중간에서 잘리지 않게 한다.
  const tokens = tokenizeSegments(splitInlineBoldSegments(line));
  const lines = [];
  let current = [];
  let currentLength = 0;

  for (const token of tokens) {
    if (token.space) {
      if (current.length > 0 && !current[current.length - 1].space) {
        current.push(token);
        currentLength += 1;
      }
      continue;
    }

    const tokenLength = displayLength(token.text);
    if (current.length > 0 && currentLength + tokenLength > maxChars) {
      trimTrailingSpaces(current);
      lines.push(mergeTokensToSegments(current));
      current = [];
      currentLength = 0;
    }

    current.push(token);
    currentLength += tokenLength;
  }

  trimTrailingSpaces(current);
  if (current.length > 0) {
    lines.push(mergeTokensToSegments(current));
  }

  return lines.length > 0 ? lines : [[]];
}

async function insertImageAt(editorFrame, page, imagePath) {
  // 네이버 에디터의 "사진" 버튼을 누르고, 생성된 이미지 파일을 업로드한다.
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await editorFrame.locator(selectors.imageToolbarButton).first().click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(imagePath);
  await page.waitForTimeout(2000);
}

async function pasteText(page, text) {
  // 긴 문장은 키보드로 한 글자씩 치는 것보다 클립보드 붙여넣기가 더 안정적이다.
  if (!text) {
    return;
  }
  clipboard.writeText(text);
  await page.keyboard.press('Control+V');
}

async function typeSegments(page, segments) {
  // 굵게 표시할 구간만 Ctrl+B를 켰다 끄고, 나머지는 일반 글자로 붙여 넣는다.
  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }
    if (segment.bold) {
      await page.keyboard.press('Control+B');
      await pasteText(page, segment.text);
      await page.keyboard.press('Control+B');
    } else {
      await pasteText(page, segment.text);
    }
  }
}

/** "이 문장에 **굵게** 표시"처럼 줄 안에 섞여 있는 굵게 마크다운을 실제 굵게 서식으로 입력한다. */
async function typeLineWithInlineBold(page, line) {
  await typeSegments(page, splitInlineBoldSegments(line));
}

async function typeBodyWithImages(editorFrame, page, body, images) {
  // 본문은 줄 단위로 읽으면서 네이버 에디터에 입력한다.
  // [IMAGE_1] 줄을 만나면 글자 대신 해당 번호의 이미지를 업로드한다.
  const readableLineMaxChars = await getReadableLineMaxChars(editorFrame);
  await editorFrame.locator(selectors.bodyComponent).first().click();

  const lines = body.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const imageMatch = line.match(/^\[IMAGE_(\d+)\]$/);

    if (imageMatch) {
      const image = images.find((img) => img.index === Number(imageMatch[1]));
      if (image) {
        await insertImageAt(editorFrame, page, image.path);
      }
    } else if (line.startsWith('## ')) {
      // 마크다운 소제목(##)은 SmartEditor에 소제목 개념이 따로 없어 굵게 표시로 대체한다.
      const headingText = line.slice(3).trim();
      if (headingText) {
        await page.keyboard.press('Control+B');
        await pasteText(page, headingText);
        await page.keyboard.press('Control+B');
        await page.keyboard.press('Enter');
      }
    } else if (isStandaloneUrlLine(line)) {
      // 내부링크 URL은 중간에 줄바꿈되면 클릭 가능한 주소가 깨질 수 있으므로 그대로 입력한다.
      await pasteText(page, line);
      await randomDelay(220, 360);
      await page.keyboard.press('Enter');
    } else if (line) {
      const readableLines = wrapLineForReadablePublishing(line, readableLineMaxChars);
      const hasInlineBold = line.includes('**');
      if (hasInlineBold) {
        for (let i = 0; i < readableLines.length; i += 1) {
          await typeSegments(page, readableLines[i]);
          await randomDelay(180, 300);
          await page.keyboard.press('Enter');
          await randomDelay(220, 360);
        }
      } else {
        // 줄 끝에 공백을 하나 둔 뒤 줄바꿈한다.
        // 네이버가 줄바꿈을 합쳐 저장하더라도 단어가 붙지 않게 하기 위해서다.
        const readableText = readableLines.map(segmentsToPlainText).join(' \n');
        await pasteText(page, readableText);
        await randomDelay(220, 360);
        await page.keyboard.press('Enter');
      }
    } else {
      await page.keyboard.press('Enter');
    }

    await randomDelay(200, 500);
  }
}

async function attemptPublish(content, { blogId, settings, scheduleAt = null }) {
  // 실제 네이버 발행 1회 시도다.
  // Playwright가 별도 브라우저를 열고, 사람이 네이버 블로그 글쓰기 화면에서 하는 일을 순서대로 대신한다.
  let stage = '로그인 확인';
  let finalPublishStarted = false;
  const context = await session.launchPersistentContext();
  let page;

  try {
    const loggedIn = await session.isLoggedIn(context, blogId);
    if (!loggedIn) {
      // 로그인 세션이 없으면 글쓰기 화면에 접근할 수 없으므로 발행을 멈춘다.
      await context.close();
      return { success: false, message: '설정에서 네이버 로그인을 먼저 해주세요.', stage, retryable: false };
    }

    stage = '글쓰기 페이지 진입';
    page = context.pages()[0] || (await context.newPage());
    await page.goto(selectors.writeUrl(blogId), { waitUntil: 'load', timeout: 30000 });
    await randomDelay();

    // 스마트에디터는 페이지 안의 별도 프레임에 있으므로, 그 안에서만 제목·본문 요소를 찾는다.
    const editorFrame = page.frames().find((f) => f.url().includes(selectors.editorFrameUrlPart));
    if (!editorFrame) {
      throw new Error('에디터 화면을 불러오지 못했습니다.');
    }

    stage = '이어작성 팝업 처리';
    try {
      // 네이버가 "작성 중이던 글을 이어서 쓰겠습니까?" 팝업을 띄우면 새 글 작성을 위해 취소한다.
      const popup = editorFrame.locator(selectors.continueWritingPopup);
      if (await popup.isVisible({ timeout: 3000 })) {
        await editorFrame.locator(selectors.continueWritingCancelButton).click();
        await randomDelay();
      }
    } catch (err) {
      // 팝업 없음 - 정상 진행
    }

    stage = '제목 입력';
    // 제목 영역을 클릭한 뒤 AI가 만든 제목을 입력한다.
    await editorFrame.locator(selectors.titleArea).click();
    await randomDelay(500, 1200);
    await page.keyboard.type(content.title, { delay: 20 });

    stage = '본문 입력';
    // 본문에는 문단, 소제목, 굵게 표시, 이미지가 모두 섞여 들어간다.
    await randomDelay();
    await typeBodyWithImages(editorFrame, page, content.body, content.images);

    stage = '발행 설정 열기';
    // 제목/본문 입력이 끝나면 네이버의 발행 설정 패널을 연다.
    await randomDelay();
    await editorFrame.locator(selectors.openPublishPanelButton).first().click();
    await randomDelay();

    stage = '카테고리 설정';
    if (settings?.publishDefaults?.category) {
      try {
        await editorFrame.locator(selectors.categorySelectButton).click({ timeout: 3000 });
        await editorFrame
          .locator(selectors.categoryOptionByName(settings.publishDefaults.category))
          .first()
          .click({ timeout: 3000 });
      } catch (err) {
        throw new Error(`설정한 카테고리 "${settings.publishDefaults.category}"를 찾지 못했습니다.`);
      }
    }

    stage = '공개 설정';
    // 설정 화면에서 선택한 공개/비공개 값을 실제 네이버 발행 옵션에 반영한다.
    const isPrivate = settings?.publishDefaults?.visibility === 'private';
    const visibilityControl = editorFrame.locator(
      isPrivate ? selectors.visibilityRadio.private : selectors.visibilityRadio.public
    );
    await visibilityControl.click();
    const visibilityInput = visibilityControl.locator('input');
    if ((await visibilityInput.count()) > 0 && !(await visibilityInput.isChecked())) {
      throw new Error('선택한 공개 설정이 적용되지 않았습니다.');
    }

    stage = '태그 입력';
    // AI가 만든 태그를 네이버 태그 입력칸에 하나씩 넣는다.
    for (const tag of content.tags || []) {
      await editorFrame.locator(selectors.tagInput).click();
      await page.keyboard.type(tag, { delay: 15 });
      await page.keyboard.press('Enter');
      await randomDelay(300, 800);
    }

    let scheduleParts = null;
    if (scheduleAt) {
      stage = '예약 시간 설정';
      scheduleParts = await configureScheduledPublish(editorFrame, page, scheduleAt);
    }

    stage = '최종 발행';
    // 마지막 확인 버튼을 누르면 실제 블로그 글이 생성된다.
    await randomDelay();
    finalPublishStarted = true;
    await editorFrame.locator(selectors.confirmPublishButton).click();
    stage = '발행 완료 확인';
    const publishedUrl = await waitForPublishCompletion(page, blogId);
    await context.close().catch(() => {});

    if (scheduleParts) {
      logger.info(`네이버 예약발행 등록 성공 [${scheduleParts.display}]: ${publishedUrl}`);
      return {
        success: true,
        url: publishedUrl,
        scheduledAt: scheduleAt,
        message: `네이버 예약발행이 등록되었습니다: ${scheduleParts.display}`,
      };
    }

    logger.info(`네이버 발행 성공: ${publishedUrl}`);
    return { success: true, url: publishedUrl, scheduledAt: null, message: `네이버 블로그에 발행되었습니다: ${publishedUrl}` };
  } catch (err) {
    // 어느 단계에서 실패했는지 stage에 담아 사용자와 개발자가 원인을 찾기 쉽게 한다.
    await saveFailureArtifacts(page, stage);
    await context.close().catch(() => {});
    logger.error(`네이버 발행 실패 [${stage}]: ${err.message}`);
    // 마지막 발행 버튼 이후에는 실제로 글이 올라갔을 가능성이 있다.
    // 이때 재시도하면 중복 글이 생길 수 있어 자동 재시도를 막는다.
    const retryNotice = finalPublishStarted
      ? ' 중복 게시를 막기 위해 자동 재시도하지 않습니다. 블로그 발행 목록을 확인해주세요.'
      : '';
    return {
      success: false,
      message: `[${stage}] 단계에서 실패했습니다: ${err.message}${retryNotice}`,
      stage,
      retryable: !finalPublishStarted,
    };
  }
}

/**
 * 공통 퍼블리셔 인터페이스: publish(content, options)
 * content: { title, body, tags, images: [{ index, path }] }
 * options: { blogId, settings }
 * 실패 시 최대 1회 재시도한다 (로그인 자체가 안 된 경우는 재시도하지 않는다).
 *
 * 비개발자용 설명:
 * 네이버 화면은 인터넷 속도나 화면 로딩 상태에 따라 가끔 클릭이 실패할 수 있다.
 * 그래서 로그인 문제가 아닌 일반 발행 실패는 한 번 더 자동으로 시도한다.
 */
async function publish(content, options) {
  const first = await attemptPublish(content, options);
  if (first.success || first.retryable === false) {
    return first;
  }
  return attemptPublish(content, options);
}

module.exports = {
  publish,
  _test: {
    calculateReadableLineMaxChars,
    extractCompletedPostUrl,
    isPublishedPostUrl,
    isStandaloneUrlLine,
    wrapLineForReadablePublishing,
  },
};
