/**
 * [프로젝트 구조 검사]
 *
 * 비개발자를 위한 설명:
 * - 파일을 옮기거나 이름을 바꾸다 보면, 서로를 참조하던 연결이 끊어져
 *   프로그램이 실행되지 않을 수 있습니다.
 * - 이 검사는 프로그램을 실행하지 않고도 "있어야 할 파일이 다 있는지",
 *   "파일끼리 서로를 제대로 찾을 수 있는지"를 미리 확인합니다.
 * - 외부 서비스나 사용자 데이터를 전혀 건드리지 않아 언제든 안전하게 실행할 수 있습니다.
 *
 * 실행: npm run check:architecture
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

const requiredPaths = [
  'frontend/apps/blog/index.html',
  'frontend/apps/creator/index.html',
  'frontend/shared/styles/app.css',
  'frontend/shared/styles/base.css',
  'frontend/shared/lib/html.js',
  'frontend/features/blog/index.js',
  'frontend/features/history/index.js',
  'frontend/features/settings/index.js',
  'frontend/features/dashboard/index.js',
  'frontend/features/instagram/index.js',
  'frontend/features/youtube/index.js',
  'backend/apps/blog/index.js',
  'backend/apps/creator/index.js',
  'backend/core/pipeline.js',
  'backend/features/blog/publisher.js',
  'backend/features/instagram/pipeline.js',
  'backend/features/youtube/pipeline.js',
  'backend/shared/ipc.js',
  'docs/architecture.md',
];

// 예전 구조에서 쓰던 경로들이다. 리팩터링 후 다시 생기면 두 벌의 코드가 공존하게 되므로
// (실제로 frontend/creator 사본이 남아 혼선을 준 적이 있다) 남아 있으면 검사에서 실패시킨다.
const removedLegacyPaths = [
  'core',
  'creator',
  'main',
  'publishers',
  'renderer',
  'pipeline.js',
  'frontend/blog',
  'frontend/creator',
  'frontend/shared/views',
];

function absolute(relativePath) {
  return path.join(projectRoot, ...relativePath.split('/'));
}

function collectJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

function resolveLocalModule(sourceFile, request) {
  const basePath = path.resolve(path.dirname(sourceFile), request);
  const candidates = [basePath, `${basePath}.js`, path.join(basePath, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function findBrokenImports(sourceFile) {
  const source = fs.readFileSync(sourceFile, 'utf8');
  const requests = [];
  const patterns = [
    /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    /(?:import|export)\s+[\s\S]*?\sfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) requests.push(match[1]);
  }

  return requests
    .filter((request) => !resolveLocalModule(sourceFile, request))
    .map((request) => `${path.relative(projectRoot, sourceFile)} -> ${request}`);
}

const errors = [];

for (const requiredPath of requiredPaths) {
  if (!fs.existsSync(absolute(requiredPath))) errors.push(`필수 경로가 없습니다: ${requiredPath}`);
}

for (const legacyPath of removedLegacyPaths) {
  if (fs.existsSync(absolute(legacyPath))) errors.push(`이전 소스 경로가 남아 있습니다: ${legacyPath}`);
}

const packageJson = JSON.parse(fs.readFileSync(absolute('package.json'), 'utf8'));
const creatorBuild = JSON.parse(fs.readFileSync(absolute('electron-builder.creator.json'), 'utf8'));

if (packageJson.main !== 'backend/apps/blog/index.js') {
  errors.push(`블로그 진입점이 올바르지 않습니다: ${packageJson.main}`);
}
if (!packageJson.build?.files?.includes('frontend/shared/**/*')) {
  errors.push('블로그 설치 파일에 공통 프론트엔드 경로가 포함되지 않았습니다.');
}
if (creatorBuild.extraMetadata?.main !== 'backend/apps/creator/index.js') {
  errors.push(`Creator 진입점이 올바르지 않습니다: ${creatorBuild.extraMetadata?.main}`);
}

const sourceRoots = ['backend', 'frontend', 'scripts'].map(absolute);
const brokenImports = sourceRoots
  .flatMap(collectJavaScriptFiles)
  .flatMap(findBrokenImports);
errors.push(...brokenImports.map((item) => `깨진 상대 경로: ${item}`));

if (errors.length > 0) {
  console.error('[구조 검사 실패]');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`구조 검사 통과: 필수 경로 ${requiredPaths.length}개, 깨진 상대 경로 0개`);
}
