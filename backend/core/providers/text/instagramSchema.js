/**
 * 인스타그램 카드뉴스 AI 응답의 형식과 허용 길이를 정의한다.
 * 공급자가 달라도 화면과 생성 파이프라인은 이 규칙으로 같은 결과를 받는다.
 */
const MIN_CARD_COUNT = 3;
const MAX_CARD_COUNT = 10;
const DEFAULT_CARD_COUNT = 5;
const MIN_TAG_COUNT = 5;
const MAX_TAG_COUNT = 15;

const RETRY_REMINDER =
  '직전 응답은 요청한 JSON 형식 또는 길이 조건을 충족하지 못했습니다. 설명이나 코드 블록 없이 JSON 객체 하나만 다시 출력하세요.';

function normalizeCardCount(value, fallback = DEFAULT_CARD_COUNT) {
  const count = Number(value);
  if (!Number.isInteger(count)) return fallback;
  return Math.min(MAX_CARD_COUNT, Math.max(MIN_CARD_COUNT, count));
}

function buildSystemPrompt({ cardCount }) {
  return `당신은 한국어 인스타그램 교육형 카드뉴스를 만드는 콘텐츠 에디터입니다.

주제는 생활 정보, 건강 정보, 제품 선택 기준처럼 사용자가 실제로 확인할 수 있는 정보여야 합니다. 과장된 광고 문구, 확인할 수 없는 개인 경험, 치료·효과 보장, 구매를 압박하는 문구는 쓰지 마세요. 정보는 구체적이되 단정하지 않고, 독자가 저장하거나 다시 확인할 수 있는 실용적인 흐름으로 구성하세요.

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
2. 첫 카드는 문제나 핵심 질문을 명확히 보여주고, 중간 카드는 근거와 비교 기준을 설명하며, 마지막 카드는 점검 목록 또는 차분한 요약으로 끝내세요.
3. headline은 6~34자, body는 32~190자 사이로 작성하세요. 줄바꿈, 이모지, 해시태그는 카드 텍스트에 넣지 마세요.
4. imagePrompt는 영어로 작성하고, 이미지 안에 글자, 숫자, 로고, 상표, 라벨이 보이지 않게 지시하세요.
5. caption은 180~1,600자 사이의 자연스러운 한국어 문장으로 작성하고, cards 내용을 그대로 반복하지 마세요.
6. tags는 서로 다른 5~15개의 관련 단어로 작성하세요. #, 공백, 브랜드명, 과도한 홍보 문구는 넣지 마세요.`;
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
