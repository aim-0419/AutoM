/**
 * electron-builder로 패키징하기 전에, 설치된 Playwright Chromium과 FFmpeg 바이너리를
 * 프로젝트 안의 vendor/ms-playwright/ 로 복사한다.
 *
 * 최종 사용자가 별도로 인터넷에서 브라우저를 내려받지 않아도 되도록,
 * 설치 파일 안에 브라우저와 영상 인코더를 함께 번들링하는 전략을 쓴다 (안정성 우선).
 * Electron 앱 진입점은 패키징 환경에서 PLAYWRIGHT_BROWSERS_PATH를 이 경로로 지정한다.
 *
 * 파일 수가 많아(수천 개) Node의 재귀 복사보다 Windows 기본 도구인 robocopy가 더 안정적이라
 * robocopy를 사용한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

function copyDirectory({ label, sourceDir, sourceExecPath, destinationRoot }) {
  if (!fs.existsSync(sourceDir) || !fs.existsSync(sourceExecPath)) {
    console.error(`설치된 ${label}을 찾을 수 없습니다: ${sourceDir}`);
    console.error('먼저 "npx playwright install chromium"을 실행하세요.');
    process.exit(1);
  }

  const destDir = path.join(destinationRoot, path.basename(sourceDir));
  const destExecPath = path.join(destDir, path.relative(sourceDir, sourceExecPath));
  console.log(`${label} 복사 중 (robocopy): ${sourceDir}`);
  console.log(`  -> ${destDir}`);
  fs.mkdirSync(destDir, { recursive: true });

  const result = spawnSync(
    'robocopy',
    [sourceDir, destDir, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP'],
    { stdio: 'inherit' }
  );

  if (result.error) {
    console.error(`robocopy를 실행하지 못했습니다: ${result.error.message}`);
    process.exit(1);
  }

  // robocopy는 0~7이 성공(부분 성공 포함), 8 이상이 실패다.
  if (result.status === null || result.status >= 8) {
    console.error(`robocopy 실패 (종료 코드 ${result.status})`);
    process.exit(1);
  }

  // 폴더만 만들어지고 실제 실행 파일이 누락된 설치본이 만들어지지 않도록 마지막에 확인한다.
  if (!fs.existsSync(destExecPath)) {
    console.error(`복사된 ${label} 실행 파일을 찾을 수 없습니다: ${destExecPath}`);
    process.exit(1);
  }

  console.log(`완료: ${destExecPath}`);
}

function main() {
  const chromiumExecPath = chromium.executablePath();
  const chromiumRevDir = path.dirname(path.dirname(chromiumExecPath));
  const browserCacheRoot = path.dirname(chromiumRevDir);
  const playwrightCoreRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const browserRegistry = JSON.parse(
    fs.readFileSync(path.join(playwrightCoreRoot, 'browsers.json'), 'utf8')
  );
  const ffmpegRevision = browserRegistry.browsers.find((browser) => browser.name === 'ffmpeg')?.revision;
  if (!ffmpegRevision) {
    console.error('Playwright FFmpeg 버전 정보를 찾을 수 없습니다.');
    process.exit(1);
  }

  const ffmpegRevDir = path.join(browserCacheRoot, `ffmpeg-${ffmpegRevision}`);
  const ffmpegExecPath = path.join(ffmpegRevDir, 'ffmpeg-win64.exe');
  const destinationRoot = path.join(__dirname, '..', 'vendor', 'ms-playwright');

  copyDirectory({
    label: 'Chromium',
    sourceDir: chromiumRevDir,
    sourceExecPath: chromiumExecPath,
    destinationRoot,
  });
  copyDirectory({
    label: 'FFmpeg',
    sourceDir: ffmpegRevDir,
    sourceExecPath: ffmpegExecPath,
    destinationRoot,
  });
}

if (require.main === module) main();

module.exports = { copyDirectory };
