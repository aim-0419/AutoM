/**
 * 실제 AI 생성과 네이버 비공개 발행을 한 번에 확인하는 최종 QA 스크립트다.
 * 실수로 실행되지 않도록 --publish-private 옵션이 있을 때만 동작한다.
 * 생성 결과·발행 전 화면·실제 게시물 화면을 output/final-live-qa에 남긴다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron, chromium } = require('playwright');

const REQUIRED_FLAG = '--publish-private';
const DEFAULT_KEYWORD = '\uC624\uBA54\uAC003 \uACE0\uB974\uB294 \uBC95\uACFC \uC12D\uCDE8 \uC8FC\uC758\uC0AC\uD56D';

function writeJson(filePath, value) {
  // 사람이 나중에 검사 결과를 다시 볼 수 있도록 중간 결과도 JSON 파일로 남긴다.
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function insertInternalLink(body, entry) {
  // 실발행 QA에서는 내부링크도 함께 확인하기 위해, 공개된 기존 글 하나를 본문 하단에 붙인다.
  const block = `\n\n## 함께 읽으면 좋은 글\n\n관련 주제가 궁금하다면 아래 글도 이어서 확인해보세요.\n\n${String(
    entry.title || entry.keyword || '관련 글'
  )
    .replace(/\s+/g, ' ')
    .trim()}\n${entry.url}`;
  const disclaimer = '\n\n---\n본 글은 일반적인 건강 정보 제공을 목적으로 하며, 의학적 진단이나 치료를 대체하지 않습니다.';
  if (body.endsWith(disclaimer)) {
    return `${body.slice(0, -disclaimer.length).trimEnd()}${block}${disclaimer}`;
  }
  return `${body.trimEnd()}${block}`;
}

async function inspectPublishedPost(url, expectedTitle, linkedLogNo, outputDir) {
  // 발행이 끝난 뒤 실제 공개 페이지를 다시 열어 제목·이미지·내부링크가 보이는지 독립적으로 확인한다.
  const profileDir = path.join(process.env.APPDATA, 'marketing-app', 'naver-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const frames = [];
    for (const frame of page.frames()) {
      const bodyText = await frame.locator('body').innerText().catch(() => '');
      const links = await frame
        .locator('a')
        .evaluateAll((elements) =>
          elements.map((element) => ({ href: element.href || '', text: element.textContent?.trim() || '' }))
        )
        .catch(() => []);
      const postImageSources = await frame
        .locator('img')
        .evaluateAll((elements) =>
          elements
            .map((element) => element.currentSrc || element.src || '')
            .filter((src) => /postfiles\.pstatic\.net|blogfiles\.pstatic\.net/i.test(src))
        )
        .catch(() => []);
      frames.push({ url: frame.url(), bodyText, links, postImageSources });
    }

    await page.screenshot({ path: path.join(outputDir, '03-published-post.png'), fullPage: true });
    const allText = frames.map((frame) => frame.bodyText).join('\n');
    const allLinks = frames.flatMap((frame) => frame.links);
    const uniquePostImages = new Set(frames.flatMap((frame) => frame.postImageSources));
    const result = {
      finalUrl: page.url(),
      titleVisible: allText.includes(expectedTitle),
      privateLabelVisible: allText.includes('비공개'),
      internalLinkElementFound: allLinks.some(
        (link) => link.href.includes(linkedLogNo) || link.text.includes(linkedLogNo)
      ),
      postImageCount: uniquePostImages.size,
      matchingLinks: allLinks.filter(
        (link) => link.href.includes(linkedLogNo) || link.text.includes(linkedLogNo)
      ),
      frameUrls: frames.map((frame) => frame.url),
    };
    writeJson(path.join(outputDir, 'published-check.json'), result);
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  // 이 스크립트의 순서는 "설정 확인 → AI 생성 → 비공개 발행 → 실제 게시물 검사"다.
  if (!process.argv.includes(REQUIRED_FLAG)) {
    throw new Error(`실제 비공개 발행에는 ${REQUIRED_FLAG} 옵션이 필요합니다.`);
  }

  const outputDir = path.join(process.cwd(), 'output', 'final-live-qa');
  fs.mkdirSync(outputDir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await electronApp.firstWindow();
  const rendererErrors = [];
  let originalVisibility = 'public';
  let publishUrl = '';
  let generatedTitle = '';
  let linkEntry;

  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));

  try {
    await page.waitForSelector('#keyword-input');
    await page.setViewportSize({ width: 1200, height: 900 });
    const state = await page.evaluate(() => window.api.getSettings());
    originalVisibility = state.settings.publishDefaults.visibility;
    if (!state.settings.text.apiKeys[state.settings.text.provider].hasKey) {
      throw new Error('텍스트 AI 키가 없습니다.');
    }
    if (!state.settings.image.apiKeys[state.settings.image.provider].hasKey) {
      throw new Error('이미지 AI 키가 없습니다.');
    }
    if (!state.settings.naver.blogId || !state.settings.naver.loggedIn) {
      throw new Error('네이버 블로그 연결 설정이 없습니다.');
    }

    await page.evaluate(() =>
      window.api.saveSettings({ publishDefaults: { visibility: 'private', maxImages: 3 } })
    );
    const historyEntries = await page.evaluate(() => window.api.historyList());
    linkEntry = historyEntries.find(
      (entry) =>
        entry.status === 'success' &&
        entry.visibility !== 'private' &&
        /^https:\/\/blog\.naver\.com\/[^/]+\/\d+/.test(entry.url || '')
    );
    if (!linkEntry) {
      throw new Error('실제 링크 입력을 확인할 기존 네이버 게시물 기록이 없습니다.');
    }

    await page.locator('#keyword-input').fill(DEFAULT_KEYWORD);
    await page.locator('input[name="mode"][value="review"]').check();
    await page.locator('#btn-generate').click();
    await page.waitForFunction(() => !document.querySelector('#btn-generate')?.disabled, null, {
      timeout: 10 * 60 * 1000,
    });

    const generationError = await page.locator('#results-area .test-result.error').first().textContent().catch(() => '');
    if (generationError) {
      throw new Error(`실제 콘텐츠 생성 실패: ${generationError}`);
    }
    await page.waitForSelector('#preview-body');
    generatedTitle = await page.locator('#preview-title').inputValue();
    const originalBody = await page.locator('#preview-body').inputValue();
    const generatedImageCount = await page.locator('.preview-image').count();
    const qualityText = await page.locator('#quality-summary').innerText();
    const qualityClass = await page.locator('#quality-summary').getAttribute('class');
    const contentSummary = {
      keyword: DEFAULT_KEYWORD,
      title: generatedTitle,
      titleChars: [...generatedTitle].length,
      bodyChars: [...originalBody].length,
      generatedImageCount,
      imageMarkers: (originalBody.match(/^\[IMAGE_\d+\]$/gm) || []).length,
      headings: (originalBody.match(/^##\s+/gm) || []).length,
      qualityText,
      qualityClass,
      rendererErrors,
    };
    writeJson(path.join(outputDir, 'generated-content-check.json'), contentSummary);
    if (generatedImageCount < 2 || !qualityClass.includes('pass') && !qualityClass.includes('caution')) {
      throw new Error('실제 생성 결과가 이미지 또는 자동 품질 기준을 충족하지 못했습니다.');
    }
    await page.screenshot({ path: path.join(outputDir, '01-generated-preview.png'), fullPage: true });

    const linkedBody = insertInternalLink(originalBody, linkEntry);
    await page.locator('#preview-body').fill(linkedBody);
    const linkedLogNo = new URL(linkEntry.url).pathname.split('/').filter(Boolean).pop();
    const previewLinkCount = await page.locator('#preview-render a').count();
    const previewHref = await page.locator('#preview-render a').first().getAttribute('href');
    writeJson(path.join(outputDir, 'internal-link-preview-check.json'), {
      sourceUrl: linkEntry.url,
      previewLinkCount,
      previewHref,
      disclaimerStillLast: linkedBody.trim().endsWith('의학적 진단이나 치료를 대체하지 않습니다.'),
    });
    if (previewLinkCount !== 1 || previewHref !== linkEntry.url) {
      throw new Error('미리보기 내부링크가 올바르게 표시되지 않았습니다.');
    }
    await page.screenshot({ path: path.join(outputDir, '02-linked-preview.png'), fullPage: true });

    await page.locator('#btn-preview-action').click();
    await page.waitForFunction(() => {
      const element = document.querySelector('#preview-action-result');
      return element?.classList.contains('success') || element?.classList.contains('error');
    }, null, { timeout: 10 * 60 * 1000 });
    const publishResultText = await page.locator('#preview-action-result').textContent();
    const publishSucceeded = await page.locator('#preview-action-result').evaluate((element) =>
      element.classList.contains('success')
    );
    const urlMatch = publishResultText.match(/https:\/\/blog\.naver\.com\/[^\s]+/);
    publishUrl = urlMatch?.[0] || '';
    writeJson(path.join(outputDir, 'publish-result.json'), {
      success: publishSucceeded,
      message: publishResultText,
      url: publishUrl,
      rendererErrors,
    });
    if (!publishSucceeded || !publishUrl) {
      throw new Error(`실제 비공개 발행 실패: ${publishResultText}`);
    }

    await page.waitForTimeout(1500);
    const publishedCheck = await inspectPublishedPost(
      publishUrl,
      generatedTitle,
      linkedLogNo,
      outputDir
    );
    if (!publishedCheck.titleVisible || publishedCheck.postImageCount < 2) {
      throw new Error('발행된 게시물에서 제목 또는 이미지 2장 이상을 확인하지 못했습니다.');
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          publishUrl,
          generatedTitle,
          generatedImageCount,
          internalLinkElementFound: publishedCheck.internalLinkElementFound,
          publishedPostImageCount: publishedCheck.postImageCount,
          privateLabelVisible: publishedCheck.privateLabelVisible,
          rendererErrors,
        },
        null,
        2
      )
    );
  } finally {
    await page
      .evaluate((visibility) => window.api.saveSettings({ publishDefaults: { visibility } }), originalVisibility)
      .catch(() => {});
    await electronApp.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
