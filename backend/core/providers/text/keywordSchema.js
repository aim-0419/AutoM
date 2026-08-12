/**
 * [키워드 추천 주문서 & 검수 규칙]
 *
 * 비개발자를 위한 설명:
 * - 화면의 '키워드 추천' 버튼을 누르면 AI가 글감이 될 만한 검색어를 5개 제안합니다.
 * - 이 파일은 그 요청의 주문서를 만들고, 돌아온 목록을 정리합니다.
 *   · 이미 써 본 키워드는 함께 보내 제외시킵니다.
 *   · 한 분야에 치우치지 않도록 여러 분야를 섞어 달라고 요청합니다.
 *   · 답변이 형식에 안 맞으면 한 번 더 요청합니다.
 * - 결과는 항상 "중복 없는 키워드 목록"으로 정리되어 화면에 전달됩니다.
 */
const RETRY_REMINDER =
  '이전 응답은 유효한 JSON이 아니었습니다. 설명이나 코드펜스 없이, 문자열 배열 형식의 JSON만 출력하세요.';

function buildSystemPrompt() {
  // 특정 업종에 고정하지 않고 실제 검색 의도가 있는 정보형 키워드를 우선하도록 기준을 전달한다.
  return `당신은 분야 제한 없이 네이버 블로그, 인스타그램, YouTube에 활용할 키워드를 기획하는 전문가입니다.

다음 규칙을 지키세요:
1. 건강, 여행, 음식, 교육, IT, 생활, 취미, 금융, 법률, 제품 비교 등 특정 분야에 고정하지 마세요.
2. 별도의 기준 주제가 없으므로 한 번의 추천 목록에는 서로 다른 분야와 검색 의도를 고르게 섞으세요.
3. 실제 사용자가 검색할 법한 구체적인 질문, 문제, 비교 또는 실행 목적이 드러나는 정보형 키워드를 추천하세요.
4. 네이버 SEO 원칙에 맞게 검색 의도가 분명하고 한 콘텐츠에서 충분히 답할 수 있는 키워드를 우선하세요.
5. 관련 없는 인기어, 유행어, 지역명, 브랜드명을 억지로 섞지 마세요.
6. 같은 뜻의 키워드를 단어 순서만 바꿔 반복하지 마세요.
7. 너무 넓은 한 단어보다 2~5단어의 자연스러운 검색어를 작성하세요. 예: "초보 홈카페 원두 고르기", "일본 소도시 여행 준비", "노트북 배터리 관리 방법".
8. 정보 확인형, 문제 해결형, 비교·선택형, 체크리스트형 검색어를 균형 있게 섞으세요.
9. 건강·의료 분야에서는 치료·완치·효과를, 금융 분야에서는 원금·수익을, 법률 분야에서는 승소·처벌 결과를 보장하는 키워드를 만들지 마세요.
10. 불법 행위, 사기, 개인정보 침해, 혐오·차별, 성적 착취 또는 위험 행동을 조장하는 키워드는 추천하지 마세요.
11. 이미 사용한 키워드와 주제가 너무 비슷하면 제외하고 새로운 분야나 관점의 키워드를 우선하세요.
12. 독자가 오래 읽을 수 있도록 배경, 원인, 비교 기준, 단계, 체크리스트, 주의점 중 여러 내용을 설명할 수 있는 키워드를 우선하세요.

다른 설명, 인사말, 코드펜스 없이 반드시 아래 JSON 배열 형식으로만 응답하세요:
["키워드1", "키워드2", "키워드3"]`;
}

function buildUserPrompt({ count, excludeKeywords }) {
  // 이미 쓴 키워드를 함께 보내 반복 추천을 줄인다.
  const excludeLine =
    excludeKeywords && excludeKeywords.length > 0
      ? `다음 키워드는 이미 사용했으니 추천에서 제외하세요: ${excludeKeywords.join(', ')}`
      : '이전에 사용한 키워드는 없습니다.';
  return `콘텐츠 분야를 제한하지 말고 서로 다른 주제의 정보형 키워드를 ${count}개 추천해주세요.\n${excludeLine}`;
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
