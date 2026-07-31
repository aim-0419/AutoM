/**
 * 키워드 자동 추천에만 쓰는 공통 규칙이다.
 * 추천 AI가 여러 공급자로 바뀌어도 화면은 항상 "중복 없는 키워드 목록"만 받는다.
 */
const RETRY_REMINDER =
  '이전 응답은 유효한 JSON이 아니었습니다. 설명이나 코드펜스 없이, 문자열 배열 형식의 JSON만 출력하세요.';

function buildSystemPrompt() {
  // 실제 검색 의도가 있는 정보형 키워드를 우선하도록 AI에 기준을 전달한다.
  return `당신은 건강 정보 블로그의 키워드 기획자입니다.

다음 규칙을 지키세요:
1. 영양제, 증상, 생활습관, 건강 관리 방법 등 사람들이 실제로 검색할 법한 건강 관련 키워드를 추천하세요.
2. 네이버 SEO 원칙에 맞게 실제 독자의 검색 의도가 분명한 정보형 키워드를 추천하세요.
3. 특정 의약품 브랜드명, 자극적이거나 과장된 표현은 피하세요.
4. 관련 없는 인기어, 유행어, 지역명, 브랜드명을 섞지 마세요.
5. 같은 뜻의 키워드를 단어 순서만 바꿔 반복하지 마세요.
6. 대량 생산된 글처럼 보일 수 있는 너무 넓고 일반적인 키워드보다 구체적인 고민이나 상황이 드러나는 키워드를 우선하세요.
7. 키워드는 2~4단어 정도의 짧은 검색어 형태로 작성하세요 (예: "루테인 눈 영양제", "마그네슘 부족 증상").
8. "완치", "치료법", "특효", "100% 효과"처럼 의학적 효과를 단정하거나 과장하는 키워드는 피하세요.
9. 한 글에서 실제로 답할 수 있는 명확한 검색 의도를 가진 키워드를 추천하세요. 너무 넓은 단어 하나짜리 키워드는 추천하지 마세요.
10. 이미 사용한 키워드와 주제가 너무 비슷하면 제외하고, 증상/생활습관/주의점/식단/검사 기준처럼 서로 다른 관점의 키워드를 섞으세요.
11. 정보성 검색어와 구매 전 비교/선택 기준 검색어를 균형 있게 섞으세요. 예: "루테인 고르는 법", "마그네슘 부족 증상", "비타민D 섭취 시간".
12. 방문자가 오래 읽을 수 있도록 원인, 증상, 비교, 체크리스트, 주의점처럼 글 안에서 충분히 설명할 거리가 있는 키워드를 우선하세요.

다른 설명, 인사말, 코드펜스 없이 반드시 아래 JSON 배열 형식으로만 응답하세요:
["키워드1", "키워드2", "키워드3"]`;
}

function buildUserPrompt({ count, excludeKeywords }) {
  // 이미 쓴 키워드를 함께 보내 반복 추천을 줄인다.
  const excludeLine =
    excludeKeywords && excludeKeywords.length > 0
      ? `다음 키워드는 이미 사용했으니 추천에서 제외하세요: ${excludeKeywords.join(', ')}`
      : '이전에 사용한 키워드는 없습니다.';
  return `건강 관련 블로그 키워드를 ${count}개 추천해주세요.\n${excludeLine}`;
}

function extractJsonArrayText(rawText) {
  // AI가 배열 외의 안내 문구를 덧붙여도 JSON 배열 부분만 꺼내 읽는다.
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function normalizeKeywords(keywords) {
  // 띄어쓰기만 다른 같은 추천어를 하나로 합친다.
  const seen = new Set();
  return keywords
    .map((keyword) => keyword.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((keyword) => {
      const key = keyword.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function parseKeywordSuggestions(rawText) {
  // 화면에 넣기 전에 응답이 문자열 배열인지 확인해 깨진 답변이 그대로 노출되지 않게 한다.
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('AI로부터 빈 응답을 받았습니다.');
  }

  let data;
  try {
    data = JSON.parse(extractJsonArrayText(rawText));
  } catch (err) {
    throw new Error('응답이 올바른 JSON 배열 형식이 아닙니다.');
  }

  if (!Array.isArray(data) || data.some((k) => typeof k !== 'string' || !k.trim())) {
    throw new Error('키워드 배열 형식이 올바르지 않습니다.');
  }

  return normalizeKeywords(data);
}

/**
 * 추천 결과가 올바른 배열이 아니면 한 번만 다시 요청한다.
 * 형식 오류를 복구하되 API 호출이 끝없이 늘어나지 않게 하는 장치다.
 */
async function generateKeywordSuggestionsWithRetry(callOnce) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callOnce(attempt);
    try {
      return parseKeywordSuggestions(raw);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`AI 응답을 해석하지 못했습니다: ${lastError.message}`);
}

module.exports = {
  RETRY_REMINDER,
  buildSystemPrompt,
  buildUserPrompt,
  parseKeywordSuggestions,
  generateKeywordSuggestionsWithRetry,
};
