/**
 * [유튜브 결과 화면 검사]
 *
 * 비개발자를 위한 설명:
 * - 유튜브 결과 화면이 제대로 보이는지, 만들어진 영상이 실제로 재생되는지 확인합니다.
 * - AI를 호출하지 않습니다. 대신 프로그램이 직접 만든 임시 이미지로 영상을 조립해
 *   화면 표시와 재생만 점검하므로 요금이 발생하지 않습니다.
 * - 임시 폴더를 쓰므로 실제 설정과 기록도 건드리지 않습니다.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron, chromium } = require('playwright');
const youtubeSchema = require('../backend/core/providers/text/youtubeSchema');
const youtubePipeline = require('../backend/features/youtube/pipeline');

async function createPreviewAssets(outputDir) {
  const request = youtubeSchema.normalizeRequest({
    format: 'shorts',
    durationSeconds: 30,
    sceneCount: 4,
    contentStyle: 'educational',
  });
  const scenes = Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    onScreenText: ['오늘의 습관 기록', '한 가지 기준 선택', '일주일 흐름 확인', '다음 행동 정하기'][index],
    narration: '막연한 느낌보다 오늘의 습관을 직접 기록하면 다음에 바꿀 행동을 구체적으로 찾을 수 있습니다.',
  }));
  const project = {
    title: '아침 피로를 줄이기 위해 먼저 확인할 생활 습관',
    originalAngle: '직접 기록하고 확인할 수 있는 순서',
    scenes,
  };
  const html = youtubePipeline._test.renderSceneHtml({
    project,
    scene: scenes[0],
    request,
    backgroundDataUri:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  });
  const framePath = path.join(outputDir, 'youtube-scene-preview.jpg');
  const videoPath = path.join(outputDir, 'youtube-video-preview.webm');
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: framePath, type: 'jpeg', quality: 90 });
  } finally {
    await browser.close();
  }
  await youtubePipeline._test.encodeVideo({
    framePaths: [framePath, framePath],
    durationSeconds: 4,
    outputPath: videoPath,
  });
  return { framePath, videoPath, scenes };
}

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const outputDir = path.join(projectRoot, 'output', 'youtube-ui-qa');
  fs.mkdirSync(outputDir, { recursive: true });
  const preview = await createPreviewAssets(outputDir);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const profilePath = path.join(outputDir, 'profile');
  env.AUTOM_CREATOR_USER_DATA_DIR = profilePath;

  const errors = [];
  const electronApp = await electron.launch({
    args: ['backend/apps/creator/index.js'],
    cwd: projectRoot,
    env,
  });

  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });

    await page.locator('[data-tab="youtube"]').click();
    await page.locator('#youtube-keyword').waitFor({ state: 'visible' });
    await page.fill('#youtube-channel-theme', '직장인의 현실적인 건강 습관');
    await page.fill('#youtube-target-audience', '건강 습관을 만들고 싶은 직장인');
    await page.fill('#youtube-creator-perspective', '생활 기록을 직접 비교한 관점을 영상에 더합니다.');
    await page.screenshot({ path: path.join(outputDir, 'youtube-desktop.png'), fullPage: true });

    await page.selectOption('#youtube-format', 'longform');
    const longformDurations = await page.locator('#youtube-duration option').evaluateAll((options) =>
      options.map((option) => option.value)
    );
    assert.deepEqual(longformDurations, ['180', '300', '480']);
    await page.selectOption('#youtube-duration', '300');
    assert.equal(await page.locator('#youtube-scene-count').inputValue(), '10');

    await page.selectOption('#youtube-format', 'shorts');
    const shortsDurations = await page.locator('#youtube-duration option').evaluateAll((options) =>
      options.map((option) => option.value)
    );
    assert.deepEqual(shortsDurations, ['30', '45', '60', '90', '180']);
    assert.equal(await page.locator('#youtube-scene-count').inputValue(), '5');

    await page.evaluate(
      async ({ frameUrl, videoUrl, workDir, scenes }) => {
        const module = await import('./views/youtube.js');
        module.renderYoutubeOutput(document.querySelector('#tab-youtube'), {
          title: '아침 피로를 줄이기 위해 먼저 확인할 생활 습관',
          format: 'shorts',
          formatLabel: '쇼츠',
          durationSeconds: 30,
          resolution: '1080x1920',
          workDir,
          videoFileUrl: videoUrl,
          factCheckNotes: ['건강 관련 수치를 확인합니다.'],
          channelAboutDraft:
            '바쁜 직장인이 일상에서 확인하고 실천할 수 있는 현실적인 건강 습관을 기록 중심으로 정리합니다.',
          authenticityReport: {
            comparedRecentCount: 3,
            notice: '이 검토는 수익 창출 승인을 보장하지 않습니다.',
            checks: [
              { id: 'channel-theme', label: '채널 주제 일치', status: 'pass', detail: '채널 핵심 주제에 맞습니다.' },
              {
                id: 'creator-contribution',
                label: '제작자 기여',
                status: 'action',
                detail: '직접 녹음하며 실제 관점을 더합니다.',
              },
              {
                id: 'top-watch-time',
                label: '인기·시청 시간 상위 영상',
                status: 'manual',
                detail: 'YouTube Studio에서 직접 확인합니다.',
              },
            ],
          },
          descriptionText: '생활 습관을 확인하는 방법을 정리했습니다.\n\n※ 일부 시각 자료는 AI로 제작되었습니다.',
          scriptText: scenes.map((scene) => `[장면 ${scene.index}]\n${scene.narration}`).join('\n\n'),
          scenes: scenes.map((scene) => ({
            ...scene,
            fileUrl: frameUrl,
            durationSeconds: 7.5,
          })),
        });
      },
      {
        frameUrl: pathToFileURL(preview.framePath).href,
        videoUrl: pathToFileURL(preview.videoPath).href,
        workDir: outputDir,
        scenes: preview.scenes,
      }
    );
    await page.locator('.youtube-video-frame video').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.youtube-policy-row').count(), 3);
    await page.screenshot({ path: path.join(outputDir, 'youtube-output.png'), fullPage: true });

    await page.setViewportSize({ width: 1000, height: 700 });
    await page.screenshot({ path: path.join(outputDir, 'youtube-compact.png'), fullPage: true });
    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
      clippedControls: Array.from(document.querySelectorAll('#tab-youtube button, #tab-youtube select')).filter(
        (element) => element.scrollWidth > element.clientWidth + 1
      ).length,
    }));
    assert.ok(layout.contentWidth <= layout.viewportWidth, `가로 넘침: ${JSON.stringify(layout)}`);
    assert.equal(layout.clippedControls, 0);
    assert.deepEqual(errors, []);

    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      JSON.stringify({ success: true, longformDurations, shortsDurations, layout, errors }, null, 2),
      'utf8'
    );
    console.log(JSON.stringify({ success: true, longformDurations, shortsDurations, layout }));
  } finally {
    await electronApp.close().catch(() => {});
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
