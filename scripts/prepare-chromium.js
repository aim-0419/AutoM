/**
 * [설치 파일 만들기 준비 - 브라우저와 영상 도구 챙기기]
 *
 * 비개발자를 위한 설명:
 * - 이 프로그램은 자동 로그인·발행을 위해 전용 브라우저(Chromium)가,
 *   영상 제작을 위해 인코더(FFmpeg)가 필요합니다.
 * - 사용자가 이것들을 따로 설치하게 하면 불편하고 실패 위험도 큽니다.
 *   그래서 설치 파일 안에 처음부터 함께 넣어 배포합니다.
 * - 이 스크립트는 설치 파일을 만들기 직전에 실행되어, 개발자 컴퓨터에 있는
 *   브라우저·인코더를 프로젝트 안(vendor 폴더)으로 복사합니다.
 * - 복사할 파일이 수천 개라 일반적인 복사 방식은 불안정합니다.
 *   그래서 Windows 기본 도구인 robocopy(대량 복사 전용 도구)를 사용합니다.
 *
 * 실행: 빌드 명령(npm run build 등)에서 자동으로 호출됩니다.
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
