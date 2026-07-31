/**
 * 블로그 앱과 Creator를 임시 사용자 데이터로 실행해 화면 구조를 검사한다.
 * 탭 이동만 수행하며 로그인, 추천, 생성, 저장, 발행 버튼은 클릭하지 않는다.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

      return {
        appId: currentAppId,
        tabId: currentTabId,
        viewport: currentViewport,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        duplicateIds: [...new Set(duplicateIds)],
        clippedControls,
        outOfBoundsControls,
      };
    },
    { appId, tabId, currentViewport: viewport }
  );
}

async function runAppSmoke(appConfig) {
  const appOutput = path.join(outputRoot, appConfig.id);
  const profilePath = path.join(appOutput, 'profile');
  fs.mkdirSync(appOutput, { recursive: true });

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
