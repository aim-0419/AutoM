/**
 * 빌드된 두 실행 파일을 직접 열어 주요 화면이 패키지 안에서도 정상인지 확인한다.
 * 화면 이동만 수행하며 로그인, 추천, 생성, 저장, 발행 버튼은 클릭하지 않는다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const outputRoot = path.join(projectRoot, 'output', 'packaged-ui');
const viewport = { width: 1000, height: 700 };

const apps = [
  {
    id: 'blog',
    executablePath: path.join(projectRoot, 'dist', 'win-unpacked', 'AutoM.exe'),
    initialTab: 'main',
    tabs: [
      { id: 'main', required: '#keyword-input' },
      { id: 'history', required: '.creator-history-card' },
      { id: 'settings', required: '.input-active-provider[data-kind="text"]' },
    ],
  },
  {
    id: 'creator',
    executablePath: path.join(
      projectRoot,
      'dist-creator',
      'win-unpacked',
      'AutoM Creator.exe'
    ),
    initialTab: 'dashboard',
    tabs: [
      { id: 'dashboard', required: '.creator-dashboard-summary' },
      { id: 'blog', required: '#keyword-input' },
      { id: 'instagram', required: '#instagram-keyword' },
      { id: 'youtube', required: '#youtube-keyword' },
      { id: 'history', required: '.creator-history-card' },
      { id: 'settings', required: '.input-active-provider[data-kind="text"]' },
    ],
  },
];

function prepareOutputDirectory() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
}

async function inspectPackagedApp(config) {
  if (!fs.existsSync(config.executablePath)) {
    throw new Error(`빌드 실행 파일이 없습니다: ${config.executablePath}`);
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    executablePath: config.executablePath,
    env,
  });
  const errors = [];
  const externalRequests = [];

  try {
    const page = await electronApp.firstWindow();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
    });
    await page.setViewportSize(viewport);

    for (const tab of config.tabs) {
      await page.locator(`[data-tab="${tab.id}"]`).evaluate((button) => button.click());
      await page
        .locator(`#tab-${tab.id} ${tab.required}`)
        .first()
        .waitFor({ state: 'visible', timeout: 8000 });
    }

    await page
      .locator(`[data-tab="${config.initialTab}"]`)
      .evaluate((button) => button.click());
    await page.screenshot({
      path: path.join(outputRoot, `${config.id}-${viewport.width}x${viewport.height}.png`),
    });

    const layout = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
      return {
        title: document.title,
        bodyClass: document.body.className,
        documentWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      };
    });

    return {
      id: config.id,
      layout,
      errors,
      externalRequests,
    };
  } finally {
    await electronApp.close().catch(() => {});
  }
}

async function main() {
  prepareOutputDirectory();
  const reports = [];
  for (const config of apps) reports.push(await inspectPackagedApp(config));

  const success = reports.every(
    (report) =>
      report.errors.length === 0 &&
      report.externalRequests.length === 0 &&
      report.layout.documentWidth <= report.layout.clientWidth &&
      report.layout.duplicateIds.length === 0
  );

  const result = { success, viewport, reports };
  fs.writeFileSync(
    path.join(outputRoot, 'result.json'),
    JSON.stringify(result, null, 2),
    'utf8'
  );
  console.log(JSON.stringify(result));
  if (!success) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
