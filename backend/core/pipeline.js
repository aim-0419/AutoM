/**
 * [글 제작 공정(파이프라인) - 키워드 1개 → 완성된 블로그 글 1편]
 *
 * 비개발자를 위한 설명:
 * - '파이프라인'은 공장의 컨베이어 벨트처럼 정해진 순서로 일을 처리한다는 뜻입니다.
 * - 이 파일이 하는 일의 순서:
 *     1) 키워드를 AI(글 담당)에게 보내 제목·본문·태그·이미지 설명을 한 번에 받습니다.
 *        본문 안에는 [IMAGE_1], [IMAGE_2] 처럼 "여기에 사진이 들어갑니다" 표시가 들어 있습니다.
 *     2) 그 표시마다 AI(이미지 담당)에게 그림을 요청해 PNG 파일로 저장합니다.
 *     3) 예전에 발행한 내 글 중 관련 있는 글을 찾아 본문 끝에 링크로 붙입니다(내부 링크).
 *     4) 건강·금융·법률처럼 민감한 주제라면 안내 문구(고지문)를 덧붙입니다.
 * - 여기서는 '만들기'까지만 합니다. 실제 네이버에 올리는 일은 features/blog가 담당합니다.
 */
const fs = require('node:fs');
const path = require('node:path');
const textProviders = require('./providers/text');
const imageProviders = require('./providers/image');
const { resolveConfiguredProvider } = require('./providers/configuredProvider');
const { isNaverBlogUrl } = require('./contentQuality');
const {
  appendSensitiveDisclaimers,
  renderDisclaimerBlock,
  splitGeneratedDisclaimerBlock,
} = require('./contentSafety');

const INTERNAL_LINK_HEADING = '함께 읽으면 좋은 글'; // 본문 끝에 붙는 관련 글 목록의 소제목
const INTERNAL_LINK_LIMIT = 3; // 관련 글은 최대 3개까지만 연결 (너무 많으면 광고처럼 보임)
const IMAGE_GENERATION_ATTEMPTS = 3; // 이미지 한 장을 만들 때 최대 3번까지 재시도

// 이미지 AI에게 항상 함께 보내는 '안전 조건' 문장이다. (영어로 보내야 AI가 더 정확히 따른다)
// 요약하면: 글자·로고·브랜드·성분표·의학적 주장·전후 비교 사진을 만들지 말라는 지시다.
// 이런 요소가 그림에 들어가면 사실이 아닌 정보를 진짜처럼 보이게 만들 수 있기 때문이다.
const IMAGE_SAFETY_SUFFIX = [
  'Create a clean original editorial image that accurately supports the informational topic.',
  'Do not include any visible or readable text, letters, numbers, logos, trademarks, brand names, labels, dosage tables, supplement facts, watermarks, charts, or medical claims.',
  'Any container or packaging must be completely plain, unbranded, and label-free.',
  'Do not create before-and-after imagery, false evidence, unsafe instructions, or guaranteed outcomes.',
].join(' ');
// 이미지 생성이 거절당했을 때 대신 사용할 '무난한 장면' 목록이다.
// (예: 깔끔한 작업 책상, 정돈된 선반 등 — 어떤 주제에도 어울리고 문제 소지가 없는 사진)
const IMAGE_FALLBACK_SCENES = [
  'a tidy worktable with simple unbranded tools and soft natural daylight',
  'an organized shelf with neutral everyday objects and balanced studio lighting',
  'a quiet indoor workspace with a blank notebook and a plain device seen from a distance',
  'a calm outdoor setting with a clear focal point and ample negative space',
];
// 내부 링크를 고를 때 '관련 있음'의 근거로 쓰지 않는 흔한 단어들이다.
// 예를 들어 두 글에 모두 "방법"이라는 단어가 있다고 해서 서로 관련된 글은 아니기 때문이다.
const INTERNAL_LINK_STOPWORDS = new Set([
  '관련',
  '기준',
  '방법',
  '선택',
  '추천',
  '정리',
  '확인',
  '체크',
  '정보',
  '건강',
  '건강정보',
  '관리',
  '생활',
  '습관',
  '가이드',
  '영양제',
  '효능',
  '효과',
  '증상',
  '주의',
  '주의사항',
  '알아보기',
  '고르는법',
  '오늘',
  '이번',
  '블로그',
  '게시글',
  '그리고',
  '하지만',
  '입니다',
  '합니다',
]);

function sanitizeForFolderName(text) {
  // 윈도우 폴더 이름에 쓸 수 없는 문자(\ / : * ? 등)는 공백으로 바꾼다.
  // 예를 들어 "비타민/영양제" 같은 키워드도 안전한 폴더명으로 저장하기 위해서다.
  return text.replace(/[\\/:*?"<>|]/g, ' ').trim().replace(/\s+/g, '_').slice(0, 50) || 'keyword';
}

function buildJobFolderName(keyword) {
  // 반자동 저장 시 "날짜-키워드" 형태의 폴더를 만든다.
  // 나중에 사용자가 결과물을 찾기 쉽도록 날짜를 앞에 붙인다.
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}-${sanitizeForFolderName(keyword)}`;
}

function stripMarker(body, index) {
  // 이미지 생성에 실패했거나 설정 개수보다 많이 나온 이미지는 본문에서 표시만 제거한다.
  // 표시가 남아 있으면 최종 글에 [IMAGE_2] 같은 문구가 그대로 보일 수 있기 때문이다.
  return body.split(`[IMAGE_${index}]`).join('');
}

function escapeMarkdownAltText(text) {
  return String(text || '')
    .replace(/[\[\]\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildImageAltText(content, imageIndex) {
  // 저장용 Markdown에서 이미지 설명이 비어 있지 않게 만든다.
  // 네이버 SEO 가이드에서 이미지의 의미를 텍스트로 설명하는 것을 권장하기 때문이다.
  return escapeMarkdownAltText(`${content.title} 관련 이미지 ${imageIndex}`) || `블로그 이미지 ${imageIndex}`;
}

function buildSafeImagePrompt(prompt) {
  // 분야와 관계없이 가짜 문구·브랜드·전후 비교가 이미지에 들어가면 정보로 오해될 수 있다.
  // AI가 만든 장면 설명 뒤에 공통 안전 조건을 붙여 이런 위험을 줄인다.
  return `${String(prompt || '').trim()}\n\n${IMAGE_SAFETY_SUFFIX}`.trim();
}

function buildImageAttemptPrompt(originalPrompt, imageIndex, attempt) {
  // 첫 요청은 글 내용에 맞춘 AI 설명을 사용한다. 같은 설명이 거절되면 완전히 중립적인
  // 생활 장면으로 바꿔 다시 요청해, 이미지 한 장 실패로 글 전체가 버려질 가능성을 줄인다.
  if (attempt === 1) {
    return buildSafeImagePrompt(originalPrompt);
  }

  const sceneOffset = Math.max(0, Number(imageIndex) - 1) + attempt - 2;
  const scene = IMAGE_FALLBACK_SCENES[sceneOffset % IMAGE_FALLBACK_SCENES.length];
  return buildSafeImagePrompt(
    `Create a realistic editorial lifestyle photograph showing ${scene}. ` +
      'Use a clean, natural composition for a general informational article. No identifiable people.'
  );
}

function normalizeLinkText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForInternalLinks(text) {
  // 새 글과 기존 글의 공통 단어를 찾아 "관련 글" 후보를 고른다.
  // 너무 흔한 단어는 관련성을 과하게 높일 수 있으므로 제외한다.
  return new Set(
    normalizeLinkText(text)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !INTERNAL_LINK_STOPWORDS.has(token))
  );
}

function getHistoryEntryTitle(entry) {
  // 내부링크에 표시할 제목이 비어 있으면 키워드를 대신 사용한다.
  return String(entry.title || entry.keyword || '관련 글').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function isPublishedHistoryEntry(entry, now = Date.now()) {
  // 실제 공개된 네이버 글만 내부링크 후보가 될 수 있다.
  const scheduledTime = Date.parse(entry?.scheduledAt || '');
  const isStillScheduled = Number.isFinite(scheduledTime) && scheduledTime > now;
  return (
    entry?.status === 'success' &&
    entry?.visibility !== 'private' &&
    !isStillScheduled &&
    isNaverBlogUrl(String(entry.url || '').trim())
  );
}

function isTestHistoryEntry(entry) {
  // 실제 운영 글 안에 발행 테스트 글이 내부링크로 들어가지 않게 막는다.
  const text = `${entry?.keyword || ''} ${entry?.title || ''}`;
  return /\btest\b|테스트|발행\s*테스트|publish\s*test/i.test(text);
}

function buildInternalLinkContext(content) {
  // 현재 글의 단어 목록은 후보마다 다시 만들지 않고 한 번만 계산한다.
  // 발행 기록이 수백·수천 건으로 늘어도 내부링크 선택이 느려지지 않게 하는 핵심 최적화다.
  const body = String(content.body || '');
  return {
    body,
    primaryTokens: tokenizeForInternalLinks(`${content.keyword || ''} ${content.title || ''}`),
    bodyTokens: tokenizeForInternalLinks(body),
  };
}

function scoreInternalLinkCandidate(context, entry) {
  // 새 글의 핵심 단어와 기존 글의 제목·키워드가 많이 겹칠수록 높은 점수를 준다.
  // 제목/키워드의 일치는 본문에 우연히 나온 단어보다 더 중요한 관련성 신호다.
  const entryText = `${entry.keyword || ''} ${entry.title || ''}`;
  const entryTokens = tokenizeForInternalLinks(entryText);
  let score = 0;

  for (const token of entryTokens) {
    if (context.primaryTokens.has(token)) {
      score += token.length >= 4 ? 4 : 3;
    } else if (context.bodyTokens.has(token)) {
      score += 1;
    }
  }

  const keyword = String(entry.keyword || '').trim();
  if (keyword && context.body.includes(keyword)) {
    score += 6;
  }

  return score;
}

/**
 * 새로 쓴 글에 어울리는 '내 예전 글'을 골라낸다.
 *
 * 제외 대상: 발행 실패한 글, 비공개 글, 아직 예약만 걸린 글, 테스트용 글,
 *            이미 본문에 들어 있는 주소, 지금 글과 같은 주제.
 * 선정 방식: 겹치는 단어에 점수를 매겨 점수가 높은 순 → 최신순으로 최대 3개.
 */
function selectInternalLinks(content, historyEntries, limit = INTERNAL_LINK_LIMIT) {
  // 중복 URL, 같은 주제, 비공개 글, 테스트 글을 제외한 뒤 관련성이 높은 글만 고른다.
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  const context = buildInternalLinkContext(content);
  const now = Date.now();
  const currentKeyword = normalizeLinkText(content.keyword);
  const currentTitle = normalizeLinkText(content.title);
  const seenUrls = new Set();
  const candidates = [];

  for (const entry of entries) {
    if (!isPublishedHistoryEntry(entry, now) || isTestHistoryEntry(entry)) {
      continue;
    }

    const url = String(entry.url).trim();
    if (seenUrls.has(url) || context.body.includes(url)) {
      continue;
    }
    seenUrls.add(url);

    const entryKeyword = normalizeLinkText(entry.keyword);
    const entryTitle = normalizeLinkText(entry.title);
    if ((entryKeyword && entryKeyword === currentKeyword) || (entryTitle && entryTitle === currentTitle)) {
      continue;
    }

    const score = scoreInternalLinkCandidate(context, entry);
    // "정보", "방법"처럼 흔한 말 하나만 겹친 글은 내부링크로 연결하지 않는다.
    if (score < 3) {
      continue;
    }

    candidates.push({
      title: getHistoryEntryTitle(entry),
      url,
      score,
      dateMs: Date.parse(entry.date || '') || 0,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.dateMs - a.dateMs)
    .slice(0, limit)
    .map(({ title, url }) => ({ title, url }));
}

function renderInternalLinksBlock(links) {
  // 네이버에 넣을 본문은 Markdown 형태이므로, 제목과 URL을 각각 한 줄로 작성한다.
  const linkLines = links.map((link) => `${link.title}\n${link.url}`).join('\n\n');
  return `\n\n## ${INTERNAL_LINK_HEADING}\n\n관련 주제가 궁금하다면 아래 글도 이어서 확인해보세요.\n\n${linkLines}`;
}

function appendInternalLinks(content, historyEntries, options = {}) {
  // 이미 발행한 성공 글 중 새 글과 단어가 겹치는 글을 하단에 자동으로 연결한다.
  // 방문자가 관련 글로 이어서 이동할 수 있어 체류시간과 페이지뷰를 늘리는 데 도움이 된다.
  const links = selectInternalLinks(content, historyEntries, options.limit || INTERNAL_LINK_LIMIT);
  if (links.length === 0 || String(content.body || '').includes(`## ${INTERNAL_LINK_HEADING}`)) {
    return { ...content, internalLinks: [] };
  }

  const body = String(content.body || '').trim();
  const block = renderInternalLinksBlock(links);
  const separated = splitGeneratedDisclaimerBlock(body);

  return {
    ...content,
    body: `${separated.body}${block}${renderDisclaimerBlock(separated.disclaimers)}`,
    internalLinks: links,
  };
}

/**
 * 키워드 하나에 대해 글과 이미지를 생성한다.
 * onProgress('text' | 'image' | 'done') 콜백으로 진행 단계를 알린다.
 *
 * 비개발자용 설명:
 * 1. 사용자가 입력한 키워드로 AI에게 블로그 글 초안을 요청한다.
 * 2. AI 글 안에는 [IMAGE_1], [IMAGE_2]처럼 이미지가 들어갈 위치가 포함된다.
 * 3. 각 위치에 맞는 이미지 설명문을 이용해 이미지를 생성한다.
 * 4. 만들어진 글, 태그, 이미지 파일 경로를 하나의 결과물로 반환한다.
 */
async function generateContent({ keyword, settings, workDir, onProgress, isCancelled }) {
  const stopIfCancelled = () => {
    // 취소 요청은 글 생성·이미지 생성 사이의 안전한 지점에서 확인한다.
    // 이렇게 하면 작업 상태와 화면 진행 표시가 서로 어긋나지 않는다.
    if (isCancelled?.()) {
      const error = new Error('사용자가 작업을 중단했습니다.');
      error.code = 'BATCH_CANCELLED';
      throw error;
    }
  };
  const textConfig = resolveConfiguredProvider(settings, 'text', textProviders);
  const textProviderId = textConfig.providerId;
  const textProvider = textProviders.get(textProviderId);
  const textApiKey = textConfig.apiKey;
  const textModel = textConfig.model;

  onProgress?.('text');
  // 먼저 글을 만든다. 이미지 프롬프트도 이 글 생성 결과 안에 함께 들어온다.
  const article = await textProvider.generateArticle({
    keyword,
    model: textModel,
    apiKey: textApiKey,
  });
  stopIfCancelled();

  const imageConfig = resolveConfiguredProvider(settings, 'image', imageProviders);
  const imageProviderId = imageConfig.providerId;
  const imageProvider = imageProviders.get(imageProviderId);
  const imageApiKey = imageConfig.apiKey;
  const imageModel = imageConfig.model;
  // 이미지 장수는 설정값을 따르되, 항상 2~4장 사이로 맞춘다.
  // (1장은 글이 허전하고, 5장 이상은 비용과 시간이 크게 늘어나기 때문)
  const maxImages = Math.min(4, Math.max(2, Number(settings.publishDefaults.maxImages) || 3));

  const promptsToUse = article.imagePrompts.slice(0, maxImages);
  let body = article.body;

  // 설정한 이미지 최대 개수보다 AI가 더 많은 이미지를 제안할 수 있다.
  // 예: 최대 3장인데 AI가 4장을 제안하면 4번째 [IMAGE_4] 표시는 지운다.
  for (let i = promptsToUse.length + 1; i <= article.imagePrompts.length; i += 1) {
    body = stripMarker(body, i);
  }

  onProgress?.('image');
  fs.mkdirSync(workDir, { recursive: true });

  // 이미지별 실패는 따로 기록한다. 한 장이 실패해도 읽을 수 있는 글 전체를 버리지는 않는다.
  const images = [];
  const imageFailures = [];
  for (let i = 0; i < promptsToUse.length; i += 1) {
    stopIfCancelled();
    const markerIndex = i + 1;
    const outputPath = path.join(workDir, `image_${markerIndex}.png`);
    let lastError;
    let usedImagePrompt;
    // 최대 3번 시도한다. 1번째는 글 내용에 딱 맞는 그림, 실패하면 2·3번째는
    // 어떤 주제에도 무난한 대체 장면으로 바꿔 요청한다.
    for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt += 1) {
      const attemptPrompt = buildImageAttemptPrompt(promptsToUse[i], markerIndex, attempt);
      try {
        const savedPath = await imageProvider.generateImage({
          prompt: attemptPrompt,
          model: imageModel,
          apiKey: imageApiKey,
          outputPath,
        });
        usedImagePrompt = attemptPrompt;
        images.push({ index: markerIndex, path: savedPath, prompt: usedImagePrompt });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    stopIfCancelled();

    if (lastError) {
      // 이미지 하나가 실패해도 전체 작업을 실패로 만들지 않는다.
      // 나머지 글과 다른 이미지는 살리고, 실패한 이미지 자리 표시만 제거한다.
      body = stripMarker(body, markerIndex);
      imageFailures.push({ index: markerIndex, message: lastError.message || '이미지 생성 실패' });
    }
  }

  // 이미지가 2장 미만이면 글을 완성하지 않고 여기서 중단한다.
  // (사진이 거의 없는 글은 블로그 노출에 불리하고, 대개 API 키·결제 문제가 원인이기 때문)
  if (images.length < 2) {
    // 최종 품질 검사에서 단순히 "이미지 1장"이라고만 나오면 사용자는 키·결제·안전 정책 중
    // 무엇을 고쳐야 하는지 알 수 없다. 실제 이미지 API 실패 이유를 여기서 바로 알려 준다.
    const failureDetails = imageFailures
      .map((failure) => `${failure.index}번: ${failure.message}`)
      .join(' / ');
    throw new Error(`이미지를 2장 이상 만들지 못했습니다. ${failureDetails || '이미지 공급자 설정을 확인해주세요.'}`);
  }

  if (settings.publishDefaults.insertDisclaimer) {
    // 일반 주제에는 고지문을 붙이지 않고 건강·금융·법률 주제에만 맞춤 안내를 붙인다.
    body = appendSensitiveDisclaimers(body, {
      keyword,
      title: article.title,
      body,
    });
  }

  onProgress?.('done');

  return {
    keyword,
    title: article.title,
    body,
    tags: article.tags,
    images,
    imageFailures,
    workDir,
  };
}

function renderMarkdownFile(content) {
  // 반자동 저장용 Markdown 파일을 만든다.
  // [IMAGE_1] 같은 표시를 실제 이미지 파일 링크로 바꾸고, 이미지 설명도 함께 넣는다.
  let body = content.body;
  content.images.forEach((img) => {
    body = body.replace(
      `[IMAGE_${img.index}]`,
      `![${buildImageAltText(content, img.index)}](image_${img.index}.png)`
    );
  });
  const tagsLine = content.tags.map((t) => `#${t}`).join(' ');
  return `# ${content.title}\n\n${body}\n\n${tagsLine}\n`;
}

function writeMarkdownFile({ content, targetDir }) {
  // 반자동 모드에서는 만든 글과 이미지가 들어 있는 폴더에 post.md를 남긴다.
  fs.mkdirSync(targetDir, { recursive: true });
  const markdown = renderMarkdownFile(content);
  fs.writeFileSync(path.join(targetDir, 'post.md'), markdown, 'utf-8');
}

module.exports = {
  generateContent,
  buildJobFolderName,
  buildSafeImagePrompt,
  buildImageAttemptPrompt,
  appendInternalLinks,
  selectInternalLinks,
  renderMarkdownFile,
  writeMarkdownFile,
};
