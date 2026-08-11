/**
 * Creator의 실제 AI 생성과 인스타그램 발행을 확인하는 최종 QA 스크립트다.
 * --publish-instagram 옵션이 없으면 실제 게시물은 만들지 않고 생성까지만 검사한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { _electron: electron } = require('playwright');

const PUBLISH_FLAG = '--publish-instagram';
const INSTAGRAM_TOPIC = '작은 집 수납 공간 정리 실전 체크리스트';
const YOUTUBE_TOPIC = '스마트폰 사진에서 중복 이미지를 찾아 정리하는 4단계';
const YOUTUBE_PROFILE = Object.freeze({
  channelTheme: '일상에서 바로 쓰는 디지털 활용법',
  targetAudience: '스마트폰과 AI 도구를 쉽게 배우고 싶은 일반 사용자',
  creatorPerspective: '직접 따라 하기 쉬운 순서와 실수하기 쉬운 지점을 중심으로 설명합니다.',
});

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function toLocalPath(fileUrl) {
  try {
    return fileURLToPath(fileUrl);
  } catch (error) {
    return '';
  }
}

function inspectFiles(fileUrls) {
  return fileUrls.map((fileUrl) => {
    const filePath = toLocalPath(fileUrl);
    const exists = Boolean(filePath && fs.existsSync(filePath));
    return {
      filePath,
      exists,
      size: exists ? fs.statSync(filePath).size : 0,
    };
  });
}

async function main() {
  const shouldPublishInstagram = process.argv.includes(PUBLISH_FLAG);
  const outputDir = path.join(process.cwd(), 'output', 'final-creator-live-qa');
  fs.mkdirSync(outputDir, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    args: ['backend/apps/creator/index.js'],
    cwd: process.cwd(),
    env,
  });
  const page = await electronApp.firstWindow();
  const rendererErrors = [];
  const report = {
    success: false,
    shouldPublishInstagram,
    keywordRecommendation: null,
    instagram: null,
    youtube: null,
    rendererErrors,
  };

  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(message.text());
  });
  page.on('pageerror', (error) => rendererErrors.push(error.message));

  try {
    await page.waitForFunction(() => Boolean(window.api));
    await page.setViewportSize({ width: 1280, height: 860 });
    const readiness = await page.evaluate(async () => {
      const state = await window.api.getSettings();
      const settings = state.settings;
      const instagram = await window.api.instagramSessionStatus();
      return {
        textKeyConfigured: Boolean(settings.text.apiKeys?.[settings.text.provider]?.hasKey),
        imageKeyConfigured: Boolean(settings.image.apiKeys?.[settings.image.provider]?.hasKey),
        outputFolderConfigured: Boolean(settings.outputFolder),
        instagramLoggedIn: Boolean(instagram.loggedIn),
      };
    });
    if (!readiness.textKeyConfigured || !readiness.imageKeyConfigured || !readiness.outputFolderConfigured) {
      throw new Error('Creator의 텍스트 AI, 이미지 AI 또는 출력 폴더 설정이 준비되지 않았습니다.');
    }
    if (shouldPublishInstagram && !readiness.instagramLoggedIn) {
      throw new Error('실제 인스타그램 발행에 필요한 로그인 세션이 없습니다.');
    }

    const recommendation = await page.evaluate(() => window.api.recommendKeyword());
    if (!recommendation.success || !String(recommendation.keyword || '').trim()) {
      throw new Error(`실제 키워드 추천 실패: ${recommendation.message || '추천 결과 없음'}`);
    }
    report.keywordRecommendation = {
      success: true,
      keyword: recommendation.keyword,
    };

    await page.locator('[data-tab="instagram"]').evaluate((button) => button.click());
    await page.waitForSelector('#instagram-keyword');
    await page.locator('#instagram-keyword').fill(INSTAGRAM_TOPIC);
    await page.locator('#instagram-card-count').selectOption('3');
    await page.locator('#btn-generate-instagram').click();
    await page.waitForFunction(() => !document.querySelector('#btn-generate-instagram')?.disabled, null, {
      timeout: 15 * 60 * 1000,
    });

    const instagramError = await page.locator('#instagram-result.error').textContent().catch(() => '');
    if (instagramError) throw new Error(`실제 인스타그램 카드 생성 실패: ${instagramError}`);
    await page.waitForSelector('#btn-publish-instagram');
    const instagramTitle = await page.locator('#instagram-result-title').innerText();
    const instagramCaption = await page.locator('#instagram-caption').inputValue();
    const instagramImageUrls = await page.locator('.instagram-preview-card img').evaluateAll((images) =>
      images.map((image) => image.currentSrc || image.src)
    );
    const instagramFiles = inspectFiles(instagramImageUrls);
    if (instagramFiles.length !== 3 || instagramFiles.some((file) => !file.exists || file.size < 2048)) {
      throw new Error('생성된 인스타그램 카드 PNG 3장을 로컬에서 확인하지 못했습니다.');
    }

    report.instagram = {
      generated: true,
      title: instagramTitle,
      captionChars: [...instagramCaption].length,
      cards: instagramFiles,
      published: false,
      publishUrl: '',
    };
    await page.screenshot({ path: path.join(outputDir, '01-instagram-generated.png'), fullPage: true });

    if (shouldPublishInstagram) {
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btn-publish-instagram').click();
      await page.waitForFunction(() => {
        const result = document.querySelector('#instagram-publish-result');
        return result?.classList.contains('success') || result?.classList.contains('error');
      }, null, { timeout: 15 * 60 * 1000 });
      const publishSucceeded = await page.locator('#instagram-publish-result').evaluate((element) =>
        element.classList.contains('success')
      );
      const publishMessage = await page.locator('#instagram-publish-result').innerText();
      const historyEntries = await page.evaluate(() => window.api.historyList());
      const historyEntry = historyEntries.find(
        (entry) => entry.platform === 'instagram' && entry.keyword === INSTAGRAM_TOPIC
      );
      report.instagram.published = publishSucceeded;
      report.instagram.publishMessage = publishMessage;
      report.instagram.publishUrl = historyEntry?.url || '';
      if (!publishSucceeded || !/^https:\/\/www\.instagram\.com\/p\//.test(report.instagram.publishUrl)) {
        throw new Error(`실제 인스타그램 발행 실패: ${publishMessage}`);
      }
      await page.screenshot({ path: path.join(outputDir, '02-instagram-published.png'), fullPage: true });
    }

    await page.locator('[data-tab="youtube"]').evaluate((button) => button.click());
    await page.waitForSelector('#youtube-keyword');
    await page.locator('#youtube-channel-theme').fill(YOUTUBE_PROFILE.channelTheme);
    await page.locator('#youtube-target-audience').fill(YOUTUBE_PROFILE.targetAudience);
    await page.locator('#youtube-creator-perspective').fill(YOUTUBE_PROFILE.creatorPerspective);
    await page.locator('#youtube-keyword').fill(YOUTUBE_TOPIC);
    await page.locator('#youtube-format').selectOption('shorts');
    await page.locator('#youtube-duration').selectOption('30');
    await page.locator('#youtube-scene-count').selectOption('4');
    await page.locator('#youtube-content-style').selectOption('educational');
    await page.locator('#btn-generate-youtube').click();
    await page.waitForFunction(() => !document.querySelector('#btn-generate-youtube')?.disabled, null, {
      timeout: 20 * 60 * 1000,
    });

    const youtubeError = await page.locator('#youtube-result.error').textContent().catch(() => '');
    if (youtubeError) throw new Error(`실제 YouTube 프로젝트 생성 실패: ${youtubeError}`);
    await page.waitForSelector('#youtube-title-output');
    const youtubeTitle = await page.locator('#youtube-title-output').inputValue();
    const youtubeScript = await page.locator('#youtube-script-output').inputValue();
    const youtubeWorkDir = await page.locator('.youtube-output-path').innerText();
    const youtubeVideoUrl = await page.locator('.youtube-video-frame video').getAttribute('src');
    const youtubeSceneUrls = await page.locator('.youtube-scene-item img').evaluateAll((images) =>
      images.map((image) => image.currentSrc || image.src)
    );
    const youtubeFiles = inspectFiles([youtubeVideoUrl, ...youtubeSceneUrls]);
    const requiredProjectFiles = ['script.txt', 'captions.srt', 'metadata.txt', 'upload-checklist.txt', 'project.json'];
    const projectFiles = requiredProjectFiles.map((filename) => {
      const filePath = path.join(youtubeWorkDir, filename);
      const exists = fs.existsSync(filePath);
      return { filename, exists, size: exists ? fs.statSync(filePath).size : 0 };
    });
    if (
      youtubeFiles.length !== 5 ||
      youtubeFiles.some((file) => !file.exists || file.size < 2048) ||
      projectFiles.some((file) => !file.exists || file.size === 0)
    ) {
      throw new Error('YouTube 영상, 장면 이미지, 대본 또는 자막 파일을 모두 확인하지 못했습니다.');
    }

    report.youtube = {
      generated: true,
      title: youtubeTitle,
      scriptChars: [...youtubeScript].length,
      workDir: youtubeWorkDir,
      mediaFiles: youtubeFiles,
      projectFiles,
    };
    await page.screenshot({ path: path.join(outputDir, '03-youtube-generated.png'), fullPage: true });

    if (rendererErrors.length > 0) {
      throw new Error(`렌더러 오류가 감지되었습니다: ${rendererErrors.join(' / ')}`);
    }
    report.success = true;
    writeJson(path.join(outputDir, 'result.json'), report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!report.success) writeJson(path.join(outputDir, 'result.json'), report);
    await electronApp.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
