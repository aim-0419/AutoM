const crypto = require('node:crypto');
const {
  DEFAULT_MIN_CHARS,
  DEFAULT_MAX_CHARS,
  MIN_TITLE_CHARS,
  MAX_TITLE_CHARS,
  MIN_TAGS,
  MAX_TAGS,
  MIN_IMAGE_MARKERS,
  MAX_IMAGE_MARKERS,
  MIN_HEADINGS,
  MAX_HEADINGS,
} = require('./providers/text/articleSchema');

/**
 * AI가 만든 글을 발행하기 전에 확인하는 "최종 품질 관문"이다.
 *
 * errors는 그대로 발행하면 안 되는 문제라 발행을 막고, warnings는 글을 더 자연스럽게
 * 다듬을 수 있다는 안내만 남긴다. 이미 공개 발행한 글의 기록도 함께 비교해 중복·유사
 * 콘텐츠가 반복되는 일을 줄인다.
 */
const INTERNAL_LINK_HEADING = '함께 읽으면 좋은 글';
const DISCLAIMER = '본 글은 일반적인 건강 정보 제공을 목적으로 하며, 의학적 진단이나 치료를 대체하지 않습니다.';
// AI가 글자 수를 아주 조금 넘길 수 있어, 요청 상한의 15%까지는 허용한다.
const MAX_BODY_CHARS = Math.ceil(DEFAULT_MAX_CHARS * 1.15);
const MAX_INTERNAL_LINKS = 3;
// 두 글의 핵심 문장 조각이 68% 이상 같으면 사실상 같은 글로 보고 발행을 막는다.
const DUPLICATE_SIMILARITY_LIMIT = 0.68;

const SIGNATURE_STOPWORDS = new Set([
  '관련',
  '경우',
  '것은',
  '것이',
  '것을',
  '그리고',
  '하지만',
  '때문에',
  '위해',
  '위한',
  '통해',
  '대한',
  '대해',
  '입니다',
  '합니다',
  '있습니다',
  '없습니다',
  '수도',
  '같은',
  '먼저',
  '다시',
  '정도',
  '정보',
  '확인',
  '방법',
  '기준',
  '정리',
  '블로그',
  '게시글',
]);

function countCharacters(value) {
  return Array.from(String(value || '')).length;
}

function normalizeComparable(value) {
  // 같은 뜻의 문장이 기호·띄어쓰기·대소문자만 달라서 비교를 피하는 일을 막는다.
  // 예: "비타민-D"와 "비타민 D"를 비교할 때는 같은 단어처럼 취급한다.
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripGeneratedAppendices(body) {
  // 고지문과 내부링크는 프로그램이 나중에 붙이는 부분이다.
  // 원래 AI가 쓴 본문만 비교해야 중복 검사 결과가 왜곡되지 않는다.
  let result = String(body || '').replace(`\n\n---\n${DISCLAIMER}`, '');
  const headingPattern = new RegExp(`\\n##\\s+${INTERNAL_LINK_HEADING.replace(/\s/g, '\\s+')}\\s*\\n`);
  const match = result.match(headingPattern);
  if (match?.index !== undefined) {
    result = result.slice(0, match.index);
  }
  return result.trim();
}

function getSignatureTokens(value) {
  // "그리고", "정보"처럼 대부분의 글에 들어가는 흔한 말은 빼고 핵심 단어만 남긴다.
  return normalizeComparable(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !SIGNATURE_STOPWORDS.has(token));
}

function createContentFingerprint(content) {
  // 완전히 같은 본문인지는 SHA-256 지문 하나로 빠르게 확인한다.
  // 원문 전체를 기록 파일에 반복 저장하지 않아도 되는 장점도 있다.
  const normalized = normalizeComparable(stripGeneratedAppendices(content?.body));
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : '';
}

function createContentSignature(content) {
  // 표현이 조금 바뀐 유사 글도 찾기 위해 연속된 핵심 단어 3개씩을 짧은 서명으로 만든다.
  // 이 서명은 "같은 문장 조각이 얼마나 겹치는지"만 비교하는 용도다.
  const tokens = getSignatureTokens(stripGeneratedAppendices(content?.body));
  if (tokens.length === 0) {
    return [];
  }

  const shingles = new Set();
  if (tokens.length < 3) {
    tokens.forEach((token) => shingles.add(token));
  } else {
    for (let i = 0; i <= tokens.length - 3; i += 1) {
      shingles.add(tokens.slice(i, i + 3).join(' '));
    }
  }

  return Array.from(shingles)
    .map((shingle) => crypto.createHash('sha1').update(shingle).digest('hex').slice(0, 12))
    .sort()
    .slice(0, 160);
}

function calculateSignatureSimilarity(first, second) {
  // 두 서명에 공통으로 있는 문장 조각 비율을 0~1 사이 숫자로 계산한다.
  // 1에 가까울수록 두 글의 내용이 서로 비슷하다는 뜻이다.
  if (!Array.isArray(first) || !Array.isArray(second) || first.length === 0 || second.length === 0) {
    return 0;
  }
  const a = new Set(first);
  const b = new Set(second);
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function isNaverBlogUrl(value) {
  // 내부링크와 기록 열기에는 실제 네이버 블로그 글 주소만 허용한다.
  // 외부 사이트나 조작된 주소를 프로그램이 열지 않도록 하는 안전장치다.
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) {
      return false;
    }
    if (/^\/[^/]+\/\d+\/?$/.test(url.pathname)) {
      return true;
    }
    return /\/PostView\.naver$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get('logNo') || '');
  } catch (err) {
    return false;
  }
}

function countExactPhrase(text, phrase) {
  if (!phrase) {
    return 0;
  }
  let count = 0;
  let position = 0;
  while ((position = text.indexOf(phrase, position)) !== -1) {
    count += 1;
    position += phrase.length;
  }
  return count;
}

function getFirstParagraph(body) {
  return stripGeneratedAppendices(body)
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .find(
      (paragraph) =>
        paragraph &&
        !paragraph.startsWith('## ') &&
        !/^\[IMAGE_\d+\]$/.test(paragraph) &&
        paragraph !== '---'
    );
}

function findRepeatedLongParagraph(body) {
  const seen = new Set();
  const paragraphs = stripGeneratedAppendices(body)
    .split(/\n\s*\n/u)
    .map(normalizeComparable)
    .filter((paragraph) => paragraph.length >= 80);

  for (const paragraph of paragraphs) {
    if (seen.has(paragraph)) {
      return true;
    }
    seen.add(paragraph);
  }
  return false;
}

function collectInternalLinkUrls(body) {
  const source = String(body || '');
  const start = source.indexOf(`## ${INTERNAL_LINK_HEADING}`);
  if (start < 0) {
    return [];
  }
  return source
    .slice(start)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\/\S+$/i.test(line));
}

/**
 * 글 하나를 구조·표현·중복 관점에서 검사한다.
 *
 * strictTopicDuplicates가 true인 완전자동 모드에서는 같은 키워드도 차단한다.
 * 사용자가 직접 검토하는 모드에서는 같은 키워드를 경고로만 보여 주어 수정 기회를 남긴다.
 */
function auditContent(content, { historyEntries = [], strictTopicDuplicates = false } = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, message) => {
    if (!errors.some((item) => item.code === code)) errors.push({ code, message });
  };
  const addWarning = (code, message) => {
    if (!warnings.some((item) => item.code === code)) warnings.push({ code, message });
  };

  const title = String(content?.title || '').trim();
  const body = String(content?.body || '');
  const coreBody = stripGeneratedAppendices(body);
  const tags = Array.isArray(content?.tags) ? content.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const markerNumbers = coreBody
    .split('\n')
    .map((line) => line.trim().match(/^\[IMAGE_(\d+)\]$/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const imageIndexes = new Set(
    (Array.isArray(content?.images) ? content.images : [])
      .map((image) => Number(image?.index))
      .filter(Number.isInteger)
  );
  const missingImageNumbers = markerNumbers.filter((index) => !imageIndexes.has(index));
  const headingCount = coreBody
    .split('\n')
    .filter((line) => /^##\s+\S/.test(line.trim()) && line.trim() !== `## ${INTERNAL_LINK_HEADING}`).length;
  const internalLinkUrls = collectInternalLinkUrls(body);
  const titleChars = countCharacters(title);
  const bodyChars = countCharacters(coreBody);
  const firstParagraph = getFirstParagraph(coreBody) || '';
  const normalizedKeyword = normalizeComparable(content?.keyword);
  const normalizedBody = normalizeComparable(coreBody);
  const keywordMentions = countExactPhrase(normalizedBody, normalizedKeyword);

  // 1단계: 제목·본문·소제목·이미지·태그처럼 발행물의 기본 구성을 확인한다.
  if (titleChars < MIN_TITLE_CHARS || titleChars > MAX_TITLE_CHARS) {
    addError('title-length', `제목은 ${MIN_TITLE_CHARS}~${MAX_TITLE_CHARS}자여야 합니다. 현재 ${titleChars}자입니다.`);
  }
  if (bodyChars < DEFAULT_MIN_CHARS || bodyChars > MAX_BODY_CHARS) {
    addError('body-length', `본문은 ${DEFAULT_MIN_CHARS}~${MAX_BODY_CHARS}자 범위여야 합니다. 현재 ${bodyChars}자입니다.`);
  }
  if (headingCount < MIN_HEADINGS || headingCount > MAX_HEADINGS) {
    addError('heading-count', `내용 소제목은 ${MIN_HEADINGS}~${MAX_HEADINGS}개여야 합니다. 현재 ${headingCount}개입니다.`);
  }
  if (markerNumbers.length < MIN_IMAGE_MARKERS || markerNumbers.length > MAX_IMAGE_MARKERS) {
    addError('image-count', `본문 이미지는 ${MIN_IMAGE_MARKERS}~${MAX_IMAGE_MARKERS}개여야 합니다. 현재 ${markerNumbers.length}개입니다.`);
  }
  if (markerNumbers.some((number, index) => number !== index + 1)) {
    addError('image-marker-order', '이미지 위치 표시는 IMAGE_1부터 중복 없이 순서대로 배치해야 합니다.');
  }
  if (missingImageNumbers.length > 0) {
    addError('missing-images', `생성되지 않은 이미지가 있습니다: ${missingImageNumbers.map((n) => `IMAGE_${n}`).join(', ')}`);
  }
  if (tags.length < MIN_TAGS || tags.length > MAX_TAGS) {
    addError('tag-count', `태그는 ${MIN_TAGS}~${MAX_TAGS}개여야 합니다. 현재 ${tags.length}개입니다.`);
  }
  if (internalLinkUrls.length > MAX_INTERNAL_LINKS) {
    addError('internal-link-count', `내부링크는 최대 ${MAX_INTERNAL_LINKS}개까지 사용할 수 있습니다.`);
  }
  if (new Set(internalLinkUrls).size !== internalLinkUrls.length) {
    addError('duplicate-internal-link', '같은 내부링크가 두 번 이상 들어가 있습니다. 중복 링크를 제거해주세요.');
  }
  if (internalLinkUrls.some((url) => !isNaverBlogUrl(url))) {
    addError('invalid-internal-link', '관련 글 영역에는 네이버 블로그의 안전한 HTTPS 주소만 사용할 수 있습니다.');
  }

  // 2단계: 건강 정보 글에서 위험한 과장 표현과 과도한 키워드 반복을 찾는다.
  // 이런 표현은 독자 신뢰와 블로그 품질에 모두 좋지 않아 오류 또는 경고로 표시한다.
  const riskyText = `${title}\n${coreBody}`;
  const overclaimPatterns = [
    /(?:100\s*%|무조건|반드시).{0,12}(?:효과|개선|치료|완치)/i,
    /(?:완치|치료)\s*(?:됩니다|된다|할\s*수\s*있습니다)/i,
    /부작용(?:이|은)?\s*(?:전혀\s*)?없(?:습니다|다)/i,
    /특효약|만병통치/i,
  ];
  if (overclaimPatterns.some((pattern) => pattern.test(riskyText))) {
    addError('medical-overclaim', '치료·완치·효과를 단정하거나 오해를 부를 수 있는 표현이 감지되었습니다.');
  }

  const salesPhrases = riskyText.match(/구매하세요|지금\s*바로|필수템|무조건\s*추천|최고의\s*제품/gi) || [];
  if (salesPhrases.length > 0) {
    addWarning('sales-language', '직접적인 구매 유도 표현이 있어 정보성 문장으로 다듬는 것이 좋습니다.');
  }
  if (normalizedKeyword && keywordMentions > 10) {
    addError('keyword-stuffing', `핵심 키워드가 본문에 ${keywordMentions}회 반복되어 과도합니다.`);
  } else if (normalizedKeyword && keywordMentions > 6) {
    addWarning('keyword-repetition', `핵심 키워드가 본문에 ${keywordMentions}회 등장합니다. 문맥이 자연스러운지 확인하세요.`);
  }

  const keywordTokens = getSignatureTokens(content?.keyword);
  const normalizedTitle = normalizeComparable(title);
  if (keywordTokens.length > 0 && !keywordTokens.every((token) => normalizedTitle.includes(token))) {
    addWarning('keyword-title-match', '제목에 핵심 키워드의 검색 의도가 모두 드러나는지 확인하세요.');
  }
  const firstParagraphChars = countCharacters(firstParagraph);
  if (firstParagraphChars < 70 || firstParagraphChars > 140) {
    addWarning('intro-length', `첫 문단은 검색 결과 요약처럼 70~140자가 읽기 좋습니다. 현재 ${firstParagraphChars}자입니다.`);
  }
  if (findRepeatedLongParagraph(coreBody)) {
    addError('repeated-paragraph', '동일한 긴 문단이 반복되어 유사·대량 생성 콘텐츠처럼 보일 수 있습니다.');
  }

  const listItemCount = coreBody.split('\n').filter((line) => /^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)).length;
  if (listItemCount < 2) {
    addWarning('actionable-structure', '체크리스트나 단계형 항목을 2개 이상 넣으면 독자가 핵심을 더 빠르게 확인할 수 있습니다.');
  }

  // 3단계: 비공개·테스트 글은 제외하고, 실제 공개 발행 이력과만 중복 여부를 비교한다.
  // 정확히 같은 글은 지문으로, 문장만 조금 바꾼 글은 유사도 서명으로 찾아낸다.
  const fingerprint = createContentFingerprint(content);
  const signature = createContentSignature(content);
  let maxHistorySimilarity = 0;
  for (const entry of Array.isArray(historyEntries) ? historyEntries : []) {
    if (entry?.status !== 'success' || entry?.visibility === 'private' || !isNaverBlogUrl(entry.url)) {
      continue;
    }
    if (fingerprint && entry.contentFingerprint === fingerprint) {
      addError('duplicate-content', '이미 발행한 글과 본문이 동일하여 중복 발행을 중단했습니다.');
    }
    const similarity = calculateSignatureSimilarity(signature, entry.contentSignature);
    maxHistorySimilarity = Math.max(maxHistorySimilarity, similarity);
    if (similarity >= DUPLICATE_SIMILARITY_LIMIT) {
      addError('similar-content', `기존 글과 본문 유사도가 높아 중복 발행을 중단했습니다. (${Math.round(similarity * 100)}%)`);
    }

    const sameTitle = normalizedTitle && normalizedTitle === normalizeComparable(entry.title);
    const sameKeyword = normalizedKeyword && normalizedKeyword === normalizeComparable(entry.keyword);
    if (sameTitle) {
      addError('duplicate-title', '이미 발행 기록에 같은 제목이 있습니다. 제목을 고유하게 바꿔주세요.');
    }
    if (sameKeyword) {
      const message = '이미 사용한 키워드와 동일합니다. 같은 검색 의도의 글을 반복 발행하지 않는 것이 안전합니다.';
      if (strictTopicDuplicates) addError('duplicate-keyword', message);
      else addWarning('duplicate-keyword', message);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      titleChars,
      bodyChars,
      headings: headingCount,
      images: markerNumbers.length - missingImageNumbers.length,
      tags: tags.length,
      internalLinks: internalLinkUrls.length,
      keywordMentions,
      maxHistorySimilarity: Math.round(maxHistorySimilarity * 100),
    },
    fingerprint,
    signature,
  };
}

function toPublicQualityReport(report) {
  // 화면에는 원문 비교용 지문을 보낼 필요가 없다. 사용자에게 필요한 검사 결과만 전달한다.
  return {
    passed: report.passed,
    errors: report.errors,
    warnings: report.warnings,
    metrics: report.metrics,
  };
}

function buildHistoryQualityFields(report) {
  // 다음 글을 검사할 때 사용할 중복 비교 정보를 발행 기록에 함께 저장한다.
  return {
    contentFingerprint: report?.fingerprint || '',
    contentSignature: Array.isArray(report?.signature) ? report.signature : [],
  };
}

function formatBlockingQualityMessage(report) {
  // 여러 차단 사유를 한 문장으로 합쳐 화면과 발행 기록에 같은 이유를 보여 준다.
  const details = (report?.errors || []).map((item) => item.message).join(' ');
  return `자동 품질 점검을 통과하지 못해 발행을 중단했습니다. ${details}`.trim();
}

module.exports = {
  auditContent,
  buildHistoryQualityFields,
  calculateSignatureSimilarity,
  createContentFingerprint,
  createContentSignature,
  formatBlockingQualityMessage,
  isNaverBlogUrl,
  stripGeneratedAppendices,
  toPublicQualityReport,
};
