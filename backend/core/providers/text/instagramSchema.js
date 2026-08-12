/**
 * [인스타그램 카드뉴스 주문서 & 검수 규칙]
 *
 * 비개발자를 위한 설명:
 * - 카드뉴스는 여러 장의 이미지를 옆으로 넘겨 보는 인스타그램 게시물입니다.
 * - AI에게 요청해서 받는 내용은 아래 5가지입니다.
 *     title       : 카드뉴스 전체 제목
 *     cards       : 각 카드의 짧은 제목(headline) + 설명(body) + 배경 그림 설명(imagePrompt)
 *     caption     : 게시물 본문 글
 *     tags        : 해시태그 단어들
 *     callToAction: "저장해두세요" 같은 마무리 권유 문장
 * - 카드 위에 글자를 얹어야 하므로 글자 수 제한이 중요합니다.
 *   제목이 너무 길면 카드 밖으로 넘치기 때문에 headline 6~34자, body 32~190자로 제한합니다.
 * - 배경 그림에는 글자가 들어가면 안 됩니다(우리가 직접 글자를 얹기 때문).
 *   그래서 AI에게 "그림 안에 글자·로고를 넣지 말라"고 지시합니다.
 */
const { GENERAL_CONTENT_SAFETY_RULES } = require('../../contentSafety');

const MIN_CARD_COUNT = 3; // 카드 최소 장수
const MAX_CARD_COUNT = 10; // 카드 최대 장수 (인스타그램 한 게시물 제한)
const DEFAULT_CARD_COUNT = 5; // 사용자가 고르지 않았을 때 기본 장수
const MIN_TAG_COUNT = 5; // 해시태그 최소 개수
const MAX_TAG_COUNT = 15; // 해시태그 최대 개수

const RETRY_REMINDER =
  '직전 응답은 요청한 JSON 형식 또는 길이 조건을 충족하지 못했습니다. 설명이나 코드 블록 없이 JSON 객체 하나만 다시 출력하세요.';

function normalizeCardCount(value, fallback = DEFAULT_CARD_COUNT) {
  const count = Number(value);
  if (!Number.isInteger(count)) return fallback;
  return Math.min(MAX_CARD_COUNT, Math.max(MIN_CARD_COUNT, count));
}

function buildSystemPrompt({ cardCount }) {
  return `당신은 한국어 인스타그램 교육형 카드뉴스를 만드는 콘텐츠 에디터입니다.

사용자가 입력한 주제가 어떤 분야든 그대로 다루고 특정 콘텐츠 분야로 제한하지 마세요. 주제의 실제 독자와 사용 맥락을 파악해 교육형, 비교형, 안내형, 스토리형 중 가장 적절한 카드 흐름을 선택하세요. 정보는 구체적이되 단정하지 않고, 독자가 저장하거나 다시 확인할 수 있도록 구성하세요.

${GENERAL_CONTENT_SAFETY_RULES}

반드시 아래 JSON 형식만 출력하세요.
{
  "title": "카드뉴스 전체 제목",
  "cards": [
    {
      "headline": "카드의 짧은 제목",
      "body": "카드에 표시할 1~3문장 설명",
      "imagePrompt": "텍스트가 없는 배경 이미지를 만들 영어 프롬프트"
    }
  ],
  "caption": "게시물 본문 캡션. 해시태그는 넣지 마세요.",
  "tags": ["해시태그에서 #을 뺀 단어"],
  "callToAction": "저장 또는 확인을 자연스럽게 권하는 짧은 문장"
}

규칙:
1. cards 배열은 정확히 ${cardCount}개여야 합니다.
2. 첫 카드는 핵심 질문이나 관심 지점을 명확히 보여주고, 중간 카드는 배경·단계·비교 기준을 설명하며, 마지막 카드는 점검 목록 또는 차분한 요약으로 끝내세요.
3. headline은 6~34자, body는 32~190자 사이로 작성하세요. 줄바꿈, 이모지, 해시태그는 카드 텍스트에 넣지 마세요.
4. imagePrompt는 영어로 작성하고, 이미지 안에 글자, 숫자, 로고, 상표, 라벨이 보이지 않게 지시하세요.
5. caption은 180~1,600자 사이의 자연스러운 한국어 문장으로 작성하고, cards 내용을 그대로 반복하지 마세요.
6. 건강·금융·법률처럼 판단에 주의가 필요한 주제는 caption 마지막에 일반 정보이며 전문가 판단을 대신하지 않는다는 짧은 안내를 넣으세요.
7. tags는 서로 다른 5~15개의 관련 단어로 작성하세요. #, 공백, 브랜드명, 과도한 홍보 문구는 넣지 마세요.`;
}

function buildUserPrompt({ keyword }) {
  return `주제: "${String(keyword || '').trim()}"\n이 주제로 인스타그램 카드뉴스를 작성하세요.`;
}

function extractJsonText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('AI 응답이 비어 있습니다.');

  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('AI 응답에서 JSON 객체를 찾지 못했습니다.');
  }
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function assertText(value, field, min, max) {
  const text = cleanText(value);
  if ([...text].length < min || [...text].length > max) {
    throw new Error(`${field}은(는) ${min}~${max}자로 작성해야 합니다.`);
  }
  return text;
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) {
    throw new Error('tags는 배열이어야 합니다.');
  }
  const tags = rawTags
    .map((tag) => cleanText(tag).replace(/^#+/, ''))
    .filter(Boolean);

  if (tags.length < MIN_TAG_COUNT || tags.length > MAX_TAG_COUNT) {
    throw new Error(`해시태그는 ${MIN_TAG_COUNT}~${MAX_TAG_COUNT}개가 필요합니다.`);
  }
  if (tags.some((tag) => /\s/.test(tag) || [...tag].length > 30)) {
    throw new Error('해시태그는 공백 없이 30자 이하로 작성해야 합니다.');
  }
  if (new Set(tags.map((tag) => tag.toLocaleLowerCase('ko-KR'))).size !== tags.length) {
    throw new Error('같은 해시태그를 반복할 수 없습니다.');
  }
  return tags;
}

function parseInstagramCarouselResponse(rawText, { cardCount = DEFAULT_CARD_COUNT } = {}) {
  const expectedCount = normalizeCardCount(cardCount);
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(rawText));
  } catch (error) {
    throw new Error(`인스타 카드뉴스 JSON을 읽지 못했습니다: ${error.message}`);
  }

  const title = assertText(parsed?.title, '제목', 6, 60);
  if (!Array.isArray(parsed?.cards) || parsed.cards.length !== expectedCount) {
    throw new Error(`카드는 정확히 ${expectedCount}개가 필요합니다.`);
  }

  const cards = parsed.cards.map((card, index) => ({
    headline: assertText(card?.headline, `${index + 1}번 카드 제목`, 6, 34),
    body: assertText(card?.body, `${index + 1}번 카드 본문`, 32, 190),
    imagePrompt: assertText(card?.imagePrompt, `${index + 1}번 카드 이미지 프롬프트`, 20, 600),
  }));

  return {
    title,
    cards,
    caption: assertText(parsed?.caption, '캡션', 180, 1600),
    tags: normalizeTags(parsed?.tags),
    callToAction: assertText(parsed?.callToAction, '마무리 문장', 6, 100),
  };
}

async function generateInstagramCarouselWithRetry(generateRaw, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await generateRaw(attempt, lastError);
    try {
      return parseInstagramCarouselResponse(raw, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('인스타 카드뉴스를 생성하지 못했습니다.');
}

module.exports = {
  MIN_CARD_COUNT,
  MAX_CARD_COUNT,
  DEFAULT_CARD_COUNT,
  RETRY_REMINDER,
  normalizeCardCount,
  buildSystemPrompt,
  buildUserPrompt,
  parseInstagramCarouselResponse,
  generateInstagramCarouselWithRetry,
};
