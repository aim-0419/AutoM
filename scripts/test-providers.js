/**
 * UI 없이 텍스트/이미지 프로바이더의 실제 생성 결과를 확인하는 테스트 스크립트.
 *
 * 사용법:
 *   ANTHROPIC_API_KEY=sk-... OPENAI_API_KEY=sk-... GEMINI_API_KEY=... \
 *     node scripts/test-providers.js --keyword="루테인 눈 영양제"
 *
 * 옵션:
 *   --keyword=<string>       테스트할 키워드 (기본값: "루테인 눈 영양제")
 *   --text=<provider>        텍스트 프로바이더 1개만 테스트 (anthropic|openai|gemini)
 *   --image=<provider>       이미지 프로바이더 1개만 테스트 (openai|gemini)
 *
 * 환경변수가 없는 프로바이더는 자동으로 건너뛴다.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const textProviders = require('../backend/core/providers/text');
const imageProviders = require('../backend/core/providers/image');

const ENV_KEY_MAP = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

function parseArgs(argv) {
  // 명령줄에서 특정 공급자·키워드만 골라 실제 연결 테스트를 할 수 있게 옵션을 읽는다.
  const args = { keyword: '루테인 눈 영양제' };
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

async function testTextProvider(providerId, keyword) {
  // 텍스트 AI는 연결 확인뿐 아니라 실제 글 JSON이 공통 규칙을 통과하는지도 시험한다.
  const provider = textProviders.get(providerId);
  const apiKey = process.env[ENV_KEY_MAP[providerId]];
  if (!apiKey) {
    console.log(`[텍스트:${providerId}] 건너뜀 (${ENV_KEY_MAP[providerId]} 환경변수 없음)`);
    return null;
  }

  console.log(`[텍스트:${providerId}] 생성 시작... (모델: ${provider.defaultModel})`);
  const started = Date.now();
  try {
    const article = await provider.generateArticle({ keyword, apiKey });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[텍스트:${providerId}] 성공 (${elapsed}초)`);
    console.log(`  제목: ${article.title}`);
    console.log(`  본문 길이: ${article.body.length}자`);
    console.log(`  이미지 마커: ${article.imagePrompts.length}개`);
    console.log(`  태그: ${article.tags.join(', ')}`);
    return article;
  } catch (err) {
    console.error(`[텍스트:${providerId}] 실패: ${err.message}`);
    return null;
  }
}

async function testImageProvider(providerId, prompt, index) {
  // 이미지 AI는 실제 PNG 파일이 생성되었는지 파일 크기까지 확인한다.
  const provider = imageProviders.get(providerId);
  const apiKey = process.env[ENV_KEY_MAP[providerId]];
  if (!apiKey) {
    console.log(`[이미지:${providerId}] 건너뜀 (${ENV_KEY_MAP[providerId]} 환경변수 없음)`);
    return null;
  }

  const outputDir = path.join(os.tmpdir(), 'marketing-app-test');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `image_${index}_${providerId}.png`);

  console.log(`[이미지:${providerId}] 생성 시작... (모델: ${provider.defaultModel})`);
  const started = Date.now();
  try {
    const savedPath = await provider.generateImage({ prompt, apiKey, outputPath });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const stat = fs.statSync(savedPath);
    console.log(`[이미지:${providerId}] 성공 (${elapsed}초) - ${savedPath} (${stat.size} bytes)`);
    return savedPath;
  } catch (err) {
    console.error(`[이미지:${providerId}] 실패: ${err.message}`);
    return null;
  }
}

async function main() {
  // API 키가 없는 공급자는 실패로 처리하지 않고 건너뛴다.
  // 개발자가 필요한 공급자만 환경변수로 설정해 개별 점검할 수 있다.
  const args = parseArgs(process.argv.slice(2));
  const keyword = args.keyword;
  const textList = args.text ? [args.text] : Object.keys(ENV_KEY_MAP);
  const imageList = args.image ? [args.image] : ['openai', 'gemini'];

  console.log(`키워드: "${keyword}"`);
  console.log('='.repeat(60));

  let article = null;
  for (const providerId of textList) {
    const result = await testTextProvider(providerId, keyword);
    if (result && !article) {
      article = result;
    }
  }

  console.log('-'.repeat(60));

  const imagePrompt =
    article?.imagePrompts?.[0] || 'A bowl of fresh blueberries on a wooden table, soft natural light';
  let index = 1;
  for (const providerId of imageList) {
    await testImageProvider(providerId, imagePrompt, index);
    index += 1;
  }

  console.log('='.repeat(60));
  console.log('테스트 완료.');
}

main().catch((err) => {
  console.error('테스트 스크립트 실행 중 오류:', err);
  process.exit(1);
});
