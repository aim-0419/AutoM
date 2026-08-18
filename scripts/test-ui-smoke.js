/**
 * [화면 기본 동작 검사]
 *
 * 비개발자를 위한 설명:
 * - 두 앱을 실제로 실행해 모든 화면이 정상적으로 열리는지 자동으로 확인합니다.
 * - 안전장치 두 가지:
 *     1) 임시 폴더를 사용하므로 실제 설정·API 키·발행 기록을 건드리지 않습니다.
 *     2) 메뉴 이동만 하고, 로그인·생성·발행 버튼은 절대 누르지 않습니다.
 *        (요금이 발생하거나 실제로 글이 올라가는 일이 없습니다)
 * - 창 크기를 여러 개로 바꿔가며 확인해, 화면이 깨지지 않는지도 함께 봅니다.
 *
 * 실행: npm run test:ui
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const outputRoot = path.join(projectRoot, 'output', 'ui-smoke');
const viewports = [
  { width: 1280, height: 860 },
  { width: 1000, height: 700 },
];

const apps = [
  {
    id: 'blog',
    entry: 'backend/apps/blog/index.js',
    userDataEnv: 'AUTOM_BLOG_USER_DATA_DIR',
    tabs: [
      { id: 'main', required: ['#keyword-input', '#btn-recommend-keyword', '#btn-generate'] },
      { id: 'history', required: ['.creator-history-card'] },
      {
        id: 'settings',
        required: [
          '.input-active-provider[data-kind="text"]',
          '#btn-save-settings',
        ],
      },
    ],
  },
  {
    id: 'creator',
    entry: 'backend/apps/creator/index.js',
    userDataEnv: 'AUTOM_CREATOR_USER_DATA_DIR',
    tabs: [
      { id: 'dashboard', required: ['.creator-dashboard-summary'] },
      { id: 'blog', required: ['#keyword-input', '#btn-recommend-keyword', '#btn-generate'] },
      {
        id: 'instagram',
        required: [
          '#instagram-keyword',
          '#btn-instagram-login',
          '#btn-instagram-reset',
          '#btn-recommend-instagram-keyword',
          '#btn-generate-instagram',
        ],
      },
      {
        id: 'youtube',
        required: ['#youtube-keyword', '#btn-recommend-youtube-keyword', '#btn-generate-youtube'],
      },
      { id: 'history', required: ['.creator-history-card'] },
      {
        id: 'settings',
        required: [
          '.input-active-provider[data-kind="text"]',
          '#btn-save-settings',
        ],
      },
    ],
  },
];

function prepareOutputDirectory() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
}

async function inspectLayout(page, appId, tabId, viewport) {
  return page.evaluate(
    ({ appId: currentAppId, tabId: currentTabId, currentViewport }) => {
      const duplicateIds = Array.from(document.querySelectorAll('[id]'))
        .map((element) => element.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index);
      const visibleControls = Array.from(
        document.querySelectorAll('button:not([hidden]), select:not([hidden]), input:not([hidden]), textarea:not([hidden])')
      ).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      const clippedControls = visibleControls
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => element.id || element.className || element.tagName);
      const outOfBoundsControls = visibleControls
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > document.documentElement.clientWidth + 1;
        })
        .map((element) => element.id || element.className || element.tagName);

      // [내용이 카드 밖으로 삐져나오는지 검사]
      // 버튼·입력칸뿐 아니라 글자와 이미지도 자기 자리를 벗어나면 안 된다.
      // 화면 내용이 담기는 영역(.creator-page-inner)의 오른쪽 끝을 기준으로,
      // 그보다 오른쪽으로 튀어나온 요소가 있으면 '영역 넘침'으로 본다.
      const contentArea = document.querySelector('.creator-page-inner');
      const contentAreaRight = contentArea ? contentArea.getBoundingClientRect().right : Infinity;
      const overflowingContent = contentArea
        ? Array.from(contentArea.querySelectorAll('*'))
            .filter((element) => {
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              // 가로 스크롤을 일부러 허용한 영역(예: 기록 표)은 넘침이 아니라 의도된 동작이다.
              if (style.overflowX === 'auto' || style.overflowX === 'scroll') return false;
              const rect = element.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return false;
              return rect.right > contentAreaRight + 1;
            })
            .map((element) => `${element.tagName}.${element.className || '(무명)'}`)
        : [];

      return {
        appId: currentAppId,
        tabId: currentTabId,
        viewport: currentViewport,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        duplicateIds: [...new Set(duplicateIds)],
        clippedControls,
        outOfBoundsControls,
        overflowingContent: [...new Set(overflowingContent)],
      };
    },
    { appId, tabId, currentViewport: viewport }
  );
}

/**
 * 일부러 아주 긴 글자를 넣은 가짜 발행 기록을 만든다.
 *
 * 왜 이렇게 하나요?
 * 기록이 하나도 없는 상태에서는 표가 비어 있어 '글자가 칸을 넘치는지'를 확인할 수 없습니다.
 * 실제 사용자는 긴 제목과 긴 주소를 쓰기 때문에, 가장 불리한 조건을 일부러 만들어
 * 그래도 화면이 깨지지 않는지 확인합니다.
 */
function buildStressHistory() {
  const longKeyword = '아주긴키워드'.repeat(12);
  const longTitle = `띄어쓰기 없는 매우 긴 제목 ${'가나다라마바사'.repeat(14)}`;
  const platforms = ['blog', 'instagram', 'youtube'];

  return platforms.flatMap((platform, platformIndex) =>
    [0, 1].map((offset) => ({
      id: `stress-${platform}-${offset}`,
      date: new Date(Date.now() - (platformIndex * 2 + offset) * 3600 * 1000).toISOString(),
      platform,
      keyword: offset === 0 ? longKeyword : '짧은 키워드',
      title: offset === 0 ? longTitle : '짧은 제목',
      mode: platform === 'youtube' ? 'youtube-shorts' : platform === 'instagram' ? 'instagram-browser' : 'review',
      status: offset === 0 ? 'success' : 'failure',
      url: platform === 'blog' ? `https://blog.naver.com/tester/${'2'.repeat(20)}` : null,
      message: '자동 검사용 기록입니다.',
    }))
  );
}

// 결과 화면 검사에 쓸 '가장 불리한' 예시 값들. 띄어쓰기 없는 긴 글자는 줄바꿈이 되지 않아
// 칸을 넘치기 가장 쉬운 조건이므로, 이 상태에서도 깨지지 않아야 한다.
const LONG_TEXT = '띄어쓰기없이아주긴한글문장이계속이어지는경우를확인한다'.repeat(4);
const LONG_PATH = `C:\\Users\\tester\\${'아주긴폴더이름'.repeat(8)}\\결과`;
const SAMPLE_IMAGE = pathToFileURL(
  path.join(projectRoot, 'frontend', 'shared', 'assets', 'platforms', 'youtube-logo.png')
).href;

/** 인스타그램 '생성 결과' 화면을 가짜 데이터로 그려 넣는다. */
async function renderInstagramStressOutput(page) {
  await page.evaluate(
    async ({ longText, longPath, imageUrl }) => {
      const module = await import('../../features/instagram/index.js');
      module.renderOutput(document.querySelector('#tab-instagram'), {
        title: longText,
        keyword: longText,
        workDir: longPath,
        captionText: `${longText}\n\n#해시태그`,
        tags: Array.from({ length: 12 }, (_, index) => `아주긴해시태그이름${index}`),
        cards: Array.from({ length: 6 }, (_, index) => ({
          index: index + 1,
          path: `${longPath}\\card_${index + 1}.png`,
          fileUrl: imageUrl,
          headline: longText,
          body: longText,
        })),
      });
    },
    { longText: LONG_TEXT, longPath: LONG_PATH, imageUrl: SAMPLE_IMAGE }
  );
}

/** 유튜브 '생성 결과' 화면을 가짜 데이터로 그려 넣는다. */
async function renderYoutubeStressOutput(page) {
  await page.evaluate(
    async ({ longText, longPath, imageUrl }) => {
      const module = await import('../../features/youtube/index.js');
      module.renderYoutubeOutput(document.querySelector('#tab-youtube'), {
        title: longText,
        format: 'shorts',
        formatLabel: '쇼츠',
        durationSeconds: 60,
        resolution: '1080x1920',
        workDir: longPath,
        videoFileUrl: '',
        factCheckNotes: ['확인 항목'],
        channelAboutDraft: longText,
        descriptionText: longText,
        scriptText: longText,
        authenticityReport: {
          comparedRecentCount: 3,
          notice: longText,
          checks: [
            { id: 'a', label: longText, status: 'pass', detail: longText },
            { id: 'b', label: '제작자 기여', status: 'action', detail: longText },
            { id: 'c', label: '상위 영상', status: 'manual', detail: longText },
          ],
        },
        scenes: Array.from({ length: 8 }, (_, index) => ({
          index: index + 1,
          fileUrl: imageUrl,
          onScreenText: longText,
          narration: longText,
          durationSeconds: 7.5,
        })),
      });
    },
    { longText: LONG_TEXT, longPath: LONG_PATH, imageUrl: SAMPLE_IMAGE }
  );
}

async function runAppSmoke(appConfig) {
  const appOutput = path.join(outputRoot, appConfig.id);
  const profilePath = path.join(appOutput, 'profile');
  fs.mkdirSync(appOutput, { recursive: true });
  // 앱이 켜지기 전에 기록 파일을 미리 넣어 두면, 기록 화면이 실제 데이터로 채워진 채 열린다.
  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(profilePath, 'history.json'),
    JSON.stringify(buildStressHistory(), null, 2),
    'utf8'
  );

  const env = { ...process.env, [appConfig.userDataEnv]: profilePath };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    args: [appConfig.entry],
    cwd: projectRoot,
    env,
  });
  const errors = [];
  const externalRequests = [];
  const layouts = [];

  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      for (const tab of appConfig.tabs) {
        await page.locator(`[data-tab="${tab.id}"]`).evaluate((button) => button.click());
        const panel = page.locator(`#tab-${tab.id}`);
        await panel.waitFor({ state: 'visible' });

        for (const selector of tab.required) {
          const requiredElement = panel.locator(selector);
          try {
            await requiredElement.first().waitFor({ state: 'visible', timeout: 5000 });
          } catch (error) {
            const diagnostics = await page.evaluate(async () => {
              let moduleError = '';
              try {
                await import('./renderer.js');
              } catch (importError) {
                moduleError = importError?.stack || importError?.message || String(importError);
              }
              return {
                url: location.href,
                title: document.title,
                bodyClass: document.body.className,
                activePanel: document.querySelector('.tab-panel.active')?.id || '',
                activePanelClass: document.querySelector('.tab-panel.active')?.className || '',
                moduleError,
              };
            });
            throw new Error(
              `${appConfig.id}/${tab.id}: ${selector} 화면 진단 실패 ${JSON.stringify(diagnostics)}\n${error.message}`
            );
          }
          assert.ok(await requiredElement.count(), `${appConfig.id}/${tab.id}: ${selector}가 없습니다.`);
        }

        if (tab.id === 'settings') {
          await panel.locator('[data-settings-target="image"]').evaluate((button) => button.click());
          await panel
            .locator('.input-active-provider[data-kind="image"]')
            .waitFor({ state: 'visible', timeout: 5000 });
          await panel.locator('[data-settings-target="text"]').evaluate((button) => button.click());
        }

        // 생성이 끝난 뒤에 보이는 '결과 화면'은 실제로 만들어 보기 전에는 나타나지 않아
        // 지금까지 넘침 검사를 하지 못했다. 여기서 가짜 결과를 그려 넣어 함께 확인한다.
        // 검사 대상이 실제로 화면에 그려졌는지 매번 확인한다.
        // (그려지지 않았는데 "통과"라고 나오면 검사가 아무 의미도 없기 때문이다)
        if (tab.id === 'instagram') {
          await renderInstagramStressOutput(page);
          assert.ok(
            await panel.locator('.instagram-preview-card').count(),
            `${appConfig.id}/${tab.id}: 결과 화면 검사용 카드가 그려지지 않았습니다.`
          );
        }
        if (tab.id === 'youtube') {
          await renderYoutubeStressOutput(page);
          assert.ok(
            await panel.locator('.youtube-scene-item').count(),
            `${appConfig.id}/${tab.id}: 결과 화면 검사용 장면이 그려지지 않았습니다.`
          );
        }
        if (tab.id === 'history') {
          assert.ok(
            await panel.locator('#history-rows tr').count(),
            `${appConfig.id}/${tab.id}: 검사용 기록이 표에 나타나지 않았습니다.`
          );
        }

        await page.evaluate(() => {
          const pageScroller = document.querySelector('.creator-page');
          const sidebarScroller = document.querySelector('.creator-sidebar');
          if (pageScroller) pageScroller.scrollTop = 0;
          if (sidebarScroller) sidebarScroller.scrollTop = 0;
          window.scrollTo(0, 0);
        });

        const layout = await inspectLayout(page, appConfig.id, tab.id, viewport);
        layouts.push(layout);
        assert.ok(
          layout.documentWidth <= layout.clientWidth,
          `${appConfig.id}/${tab.id}: 가로 넘침 ${JSON.stringify(layout)}`
        );
        assert.deepEqual(layout.duplicateIds, [], `${appConfig.id}/${tab.id}: 중복 ID`);
        assert.deepEqual(layout.clippedControls, [], `${appConfig.id}/${tab.id}: 잘린 컨트롤`);
        assert.deepEqual(layout.outOfBoundsControls, [], `${appConfig.id}/${tab.id}: 화면 밖 컨트롤`);
        assert.deepEqual(layout.overflowingContent, [], `${appConfig.id}/${tab.id}: 영역을 넘어간 내용`);

        await page.screenshot({
          path: path.join(appOutput, `${viewport.width}x${viewport.height}-${tab.id}.png`),
          fullPage: true,
        });
      }
    }

    assert.deepEqual(errors, [], `${appConfig.id}: 콘솔 오류`);
    assert.deepEqual(externalRequests, [], `${appConfig.id}: 외부 요청`);
    return { appId: appConfig.id, layouts, errors, externalRequests };
  } finally {
    await electronApp.close().catch(() => {});
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
}

async function main() {
  prepareOutputDirectory();
  const results = [];
  for (const appConfig of apps) results.push(await runAppSmoke(appConfig));

  const report = {
    success: true,
    checkedApps: results.length,
    checkedLayouts: results.reduce((sum, result) => sum + result.layouts.length, 0),
    consoleErrors: results.reduce((sum, result) => sum + result.errors.length, 0),
    externalRequests: results.reduce((sum, result) => sum + result.externalRequests.length, 0),
  };
  fs.writeFileSync(path.join(outputRoot, 'result.json'), JSON.stringify({ ...report, results }, null, 2), 'utf8');
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
