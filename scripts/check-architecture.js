/**
 * 소스 폴더를 옮긴 뒤 빠진 파일이나 깨진 상대 경로가 없는지 확인한다.
 * 외부 서비스나 사용자 데이터를 사용하지 않는 안전한 정적 검사다.
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

const requiredPaths = [
  'frontend/blog/index.html',
  'frontend/creator/index.html',
  'frontend/shared/styles/app.css',
  'frontend/shared/views/blog.js',
  'frontend/shared/views/history.js',
  'frontend/shared/views/settings.js',
  'backend/apps/blog/index.js',
  'backend/apps/creator/index.js',
  'backend/core/pipeline.js',
  'backend/features/blog/publisher.js',
  'backend/features/instagram/pipeline.js',
  'backend/features/youtube/pipeline.js',
  'backend/shared/ipc.js',
  'docs/architecture.md',
];

const removedLegacyPaths = [
  'core',
  'creator',
  'main',
  'publishers',
  'renderer',
  'pipeline.js',
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
