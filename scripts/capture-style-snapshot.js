/**
 * [디자인 스냅샷 비교 도구 - 개발자용]
 *
 * 비개발자를 위한 설명:
 * - CSS(디자인 파일)를 정리하거나 나눌 때 가장 무서운 일은 "코드는 정리했는데
 *   화면 모양이 미묘하게 달라지는 것"입니다. 사람 눈으로는 알아채기 어렵습니다.
 * - 이 도구는 두 앱의 모든 화면을 실제로 띄운 뒤, 화면에 있는 모든 요소의
 *   위치·크기·색·글꼴 같은 값을 전부 기록해 파일로 남깁니다.
 * - 정리 작업 '전'과 '후'의 기록을 비교해 단 한 글자라도 달라지면 알려 줍니다.
 *   즉, "디자인은 그대로 두고 파일만 정리했다"는 것을 기계가 증명해 줍니다.
 *
 * 사용법:
 *   node scripts/capture-style-snapshot.js before   (정리하기 전에 실행)
 *   node scripts/capture-style-snapshot.js after    (정리한 뒤에 실행)
 *   node scripts/capture-style-snapshot.js compare  (두 기록을 비교)
 */
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const snapshotRoot = path.join(projectRoot, 'output', 'style-snapshots');

// 비교할 CSS 속성 목록. 레이아웃(위치·크기), 글자, 색, 여백, 넘침 처리까지 포함한다.
const TRACKED_PROPERTIES = [
  'display', 'position', 'boxSizing', 'width', 'height', 'minWidth', 'minHeight',
  'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth',
  'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopColor',
  'borderBottomColor', 'borderRadius', 'color', 'backgroundColor', 'backgroundImage',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign',
  'textTransform', 'textOverflow', 'whiteSpace', 'wordBreak', 'overflowWrap',
  'overflowX', 'overflowY', 'opacity', 'visibility', 'zIndex', 'boxShadow',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap', 'flexGrow',
  'flexShrink', 'flexBasis', 'gridTemplateColumns', 'gridTemplateRows', 'order',
];

const viewports = [
  { width: 1280, height: 860 },
  { width: 1000, height: 700 },
];

const apps = [
  {
    id: 'blog',
    entry: 'backend/apps/blog/index.js',
    userDataEnv: 'AUTOM_BLOG_USER_DATA_DIR',
    tabs: ['main', 'history', 'settings'],
  },
  {
    id: 'creator',
    entry: 'backend/apps/creator/index.js',
    userDataEnv: 'AUTOM_CREATOR_USER_DATA_DIR',
    tabs: ['dashboard', 'blog', 'instagram', 'youtube', 'history', 'settings'],
  },
];

/** 화면 안 모든 요소의 계산된 스타일을 '요소 경로 → 값' 형태로 뽑아낸다. */
async function captureStyles(page, properties) {
  return page.evaluate((trackedProperties) => {
    // 요소를 가리키는 안정적인 이름을 만든다. (부모에서 몇 번째 자식인지로 경로를 구성)
    const describe = (element) => {
      const parts = [];
      let current = element;
      while (current && current !== document.documentElement) {
        const parent = current.parentElement;
        if (!parent) break;
        parts.unshift(`${current.tagName}[${Array.prototype.indexOf.call(parent.children, current)}]`);
        current = parent;
      }
      return parts.join('>');
    };

    const result = {};
    for (const element of document.querySelectorAll('*')) {
      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const values = [
        `rect:${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`,
      ];
      for (const property of trackedProperties) values.push(`${property}:${computed[property]}`);
      result[describe(element)] = values.join('|');
    }
    return result;
  }, properties);
}

async function captureApp(appConfig, label) {
  const profilePath = path.join(snapshotRoot, label, `${appConfig.id}-profile`);
  fs.mkdirSync(profilePath, { recursive: true });
  const env = { ...process.env, [appConfig.userDataEnv]: profilePath };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({ args: [appConfig.entry], cwd: projectRoot, env });
  const snapshot = {};
  try {
    const page = await electronApp.firstWindow();
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const tabId of appConfig.tabs) {
        await page.locator(`[data-tab="${tabId}"]`).evaluate((button) => button.click());
        await page.locator(`#tab-${tabId}`).waitFor({ state: 'visible' });
        // 설정 화면은 그룹이 나뉘어 있으므로 각 그룹을 차례로 열어 전부 기록한다.
        const groups = tabId === 'settings'
          ? ['text', 'image', 'accounts', 'publish', 'output']
          : [null];
        for (const group of groups) {
          if (group) {
            await page.locator(`[data-settings-target="${group}"]`).evaluate((button) => button.click());
          }
          await page.waitForTimeout(120);
          const key = `${appConfig.id}/${viewport.width}x${viewport.height}/${tabId}${group ? `/${group}` : ''}`;
          snapshot[key] = await captureStyles(page, TRACKED_PROPERTIES);
        }
      }
    }
  } finally {
    await electronApp.close().catch(() => {});
    fs.rmSync(profilePath, { recursive: true, force: true });
  }
  return snapshot;
}

async function capture(label) {
  fs.mkdirSync(path.join(snapshotRoot, label), { recursive: true });
  const snapshot = {};
  for (const appConfig of apps) Object.assign(snapshot, await captureApp(appConfig, label));
  const target = path.join(snapshotRoot, `${label}.json`);
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 1), 'utf8');
  const elementCount = Object.values(snapshot).reduce((sum, screen) => sum + Object.keys(screen).length, 0);
  console.log(JSON.stringify({ label, screens: Object.keys(snapshot).length, elements: elementCount }));
}

function compare() {
  const before = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'before.json'), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'after.json'), 'utf8'));
  const differences = [];

  const screenKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const screenKey of screenKeys) {
    const beforeScreen = before[screenKey];
    const afterScreen = after[screenKey];
    if (!beforeScreen || !afterScreen) {
      differences.push(`${screenKey}: 화면이 한쪽에만 있습니다.`);
      continue;
    }
    const elementKeys = new Set([...Object.keys(beforeScreen), ...Object.keys(afterScreen)]);
    for (const elementKey of elementKeys) {
      if (beforeScreen[elementKey] === afterScreen[elementKey]) continue;
      const beforeValues = (beforeScreen[elementKey] || '').split('|');
      const afterValues = (afterScreen[elementKey] || '').split('|');
      const changed = beforeValues
        .filter((value, index) => value !== afterValues[index])
        .map((value, index) => `${value} -> ${afterValues[beforeValues.indexOf(value)] ?? '(없음)'}`);
      differences.push(`${screenKey} ${elementKey}: ${changed.slice(0, 6).join(', ')}`);
    }
  }

  if (differences.length === 0) {
    console.log('디자인 스냅샷 일치: 정리 전후 화면이 완전히 동일합니다.');
    return;
  }
  console.error(`디자인 차이 ${differences.length}건:`);
  for (const difference of differences.slice(0, 40)) console.error(`- ${difference}`);
  process.exitCode = 1;
}

const command = process.argv[2];
if (command === 'compare') {
  compare();
} else if (command === 'before' || command === 'after') {
  capture(command).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
} else {
  console.error('사용법: node scripts/capture-style-snapshot.js <before|after|compare>');
  process.exit(1);
}
