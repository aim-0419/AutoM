/**
 * 어떤 텍스트 AI를 선택해도 같은 형식의 블로그 글을 받도록 만드는 공통 규칙이다.
 * AI에게 줄 작성 지시문과, 돌아온 답변의 형식 검사를 한곳에서 관리한다.
 */
const { GENERAL_CONTENT_SAFETY_RULES } = require('../../contentSafety');

const DEFAULT_TONE = '친근하고 신뢰감 있는 정보성 말투';
const DEFAULT_MIN_CHARS = 1800;
const DEFAULT_MAX_CHARS = 2800;

const RETRY_REMINDER =
  '이전 응답은 유효한 JSON이 아니었습니다. 설명이나 코드펜스 없이, 요청한 형식의 JSON 객체 하나만 출력하세요.';

const MAX_TITLE_CHARS = 40;
const MIN_TITLE_CHARS = 20;
const MAX_TAGS = 8;
const MIN_TAGS = 5;
const MIN_IMAGE_MARKERS = 2;
const MAX_IMAGE_MARKERS = 4;
const MIN_HEADINGS = 2;
const MAX_HEADINGS = 4;
const MAX_BODY_OVERAGE_RATIO = 1.15;

function buildSystemPrompt({ tone, minChars, maxChars }) {
  // AI에게 범용 콘텐츠 역할, 분야별 안전 기준, SEO 문서 구성, 반환 형식을 한 번에 전달한다.
  // 실제 글 내용은 아래 buildUserPrompt에서 사용자가 입력한 키워드와 함께 별도로 보낸다.
  return `당신은 사용자가 입력한 어떤 주제든 네이버 블로그용 정보 콘텐츠로 구성하는 전문 카피라이터입니다.

건강, 금융, 법률, 여행, 음식, 교육, IT, 생활, 취미, 제품 비교 등 콘텐츠 분야를 제한하지 마세요. 입력된 키워드의 분야와 검색 의도를 먼저 파악하고, 그 분야에 맞는 용어와 설명 방식을 사용하세요.

${GENERAL_CONTENT_SAFETY_RULES}

다음 규칙을 반드시 지키세요:
1. 톤앤매너: ${tone}
2. 본문 글자 수는 공백 포함 ${minChars}자에서 ${maxChars}자 사이로 작성하세요.
3. 본문은 마크다운 형식이며, "##" 소제목을 2~4개 포함해야 합니다.
4. 이미지를 넣을 위치에 [IMAGE_1], [IMAGE_2]와 같은 마커를 본문 흐름에 자연스럽게 삽입하세요. 마커는 2~4개 사용하고, 각 마커는 반드시 별도 한 줄에 단독으로 작성하세요.
5. 각 마커에 대응하는 이미지 생성 프롬프트를 영어로 작성하세요. imagePrompts 배열의 순서는 마커 번호 순서와 정확히 일치해야 합니다.
6. 블로그 태그를 5~8개 생성하세요. 키워드를 자연스럽게 포함하되, 같은 의미의 태그를 반복하거나 관련 없는 인기 태그를 넣지 마세요.
7. 제목은 핵심 키워드를 한 번만 자연스럽게 포함하고, 20~40자 안에서 본문 내용을 정확히 설명하는 고유한 제목으로 작성하세요. 과장형, 낚시형, 키워드 나열형 제목은 피하세요.
8. 첫 문단은 검색 결과 설명문처럼 읽힐 수 있도록 70~120자 정도로 글의 핵심을 요약하세요. 첫 문단에 인사말, 광고성 문장, 과도한 감탄문을 넣지 마세요.
9. 네이버 SEO 기본 원칙에 맞게 검색엔진보다 실제 독자를 우선하세요. 복사한 글, 짜깁기한 글, 대량 생산된 템플릿처럼 보이는 글을 만들지 마세요.
10. 글의 목적은 "정보 제공 70%, 자연스러운 마케팅/선택 기준 30%"입니다. 노골적인 광고글이 아니라, 독자가 스스로 필요성과 선택 기준을 이해하도록 작성하세요.
11. 같은 키워드를 부자연스럽게 반복하지 말고, 관련 없는 유행어·인기어·지역명·브랜드명을 넣지 마세요.
12. 이미지 프롬프트는 각 소제목을 대표하는 서로 다른 장면으로 작성하세요. 이미지 안에 읽을 수 있는 글자, 숫자, 로고, 브랜드, 제품 라벨, 허위 증거, 과장된 전후 비교가 보이지 않게 하세요.
13. 소제목은 "정리", "마무리"처럼 의미가 약한 표현보다 독자가 내용을 예측할 수 있는 구체적인 문장으로 작성하세요.
14. 검색 노출, 순위 상승, 판매량, 효과나 결과를 보장하는 표현을 쓰지 마세요.
15. 글 흐름은 주제에 맞춰 "독자의 질문 → 핵심 배경과 기준 → 확인 또는 비교 방법 → 실천 방법 → 주의점" 순서로 자연스럽게 구성하세요.
16. 본문에는 독자가 바로 적용할 수 있는 체크리스트, 단계별 확인법, 비교 기준, 사례를 판단하는 질문, 흔한 실수 중 2개 이상을 포함하세요.
17. 홍보가 필요한 주제라도 "구매하세요", "지금 바로", "최고", "필수템" 같은 판매 문구는 피하고, 상황·선택 기준·장단점·주의점 중심으로 설명하세요.
18. 마지막 문단은 광고 클릭이나 수익을 직접 언급하지 말고, 독자가 다음 행동을 정할 수 있게 짧은 요약과 확인 포인트로 마무리하세요.
19. 문단마다 2~4문장 정도로 끊어 읽기 쉽게 작성하고, 중간중간 독자가 계속 읽을 이유가 되는 질문형 연결 문장을 1~2개만 자연스럽게 넣으세요.

다른 설명, 인사말, 코드펜스 없이 반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "string",
  "body": "string (마크다운, [IMAGE_n] 마커 포함)",
  "imagePrompts": ["string", "..."],
  "tags": ["string", "..."]
}`;
}

function buildUserPrompt({ keyword }) {
  // 키워드는 사용자 입력값이므로 긴 규칙문과 분리해 AI에 전달한다.
  return `키워드: "${keyword}"\n위 키워드로 블로그 글을 작성해주세요.`;
}

function extractJsonText(rawText) {
  // AI가 설명문이나 ```json 표시를 덧붙여도, 가운데의 JSON 객체만 골라 해석한다.
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function normalizeTitle(title) {
  // AI가 제목 앞에 #, 따옴표, 불필요한 공백을 붙여도 실제 제목은 깔끔하게 저장한다.
  return title
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeTags(tags) {
  // 태그의 # 기호와 중복을 정리해 네이버에 같은 태그가 여러 번 들어가지 않게 한다.
  const seen = new Set();
  return tags
    .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, ' '))
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TAGS);
}

function getImageMarkerNumbers(body) {
  return [...body.matchAll(/\[IMAGE_(\d+)\]/g)].map((match) => Number(match[1]));
}

function getLineOnlyImageMarkerNumbers(body) {
  return body
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/^\[IMAGE_(\d+)\]$/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
}

function validateImageMarkers(body, imagePrompts) {
  // [IMAGE_1] 위치 표시와 이미지 설명문은 1:1로 맞아야 본문 중간에 정확히 이미지를 넣을 수 있다.
  const allMarkers = getImageMarkerNumbers(body);
  const lineOnlyMarkers = getLineOnlyImageMarkerNumbers(body);

  if (allMarkers.length !== imagePrompts.length) {
    throw new Error(
      `본문의 이미지 마커 개수(${allMarkers.length})와 imagePrompts 개수(${imagePrompts.length})가 일치하지 않습니다.`
    );
  }

  if (allMarkers.length !== lineOnlyMarkers.length) {
    throw new Error('이미지 마커는 반드시 별도 한 줄에 단독으로 작성해야 합니다.');
  }

  if (allMarkers.length < MIN_IMAGE_MARKERS || allMarkers.length > MAX_IMAGE_MARKERS) {
    throw new Error(`이미지 마커는 ${MIN_IMAGE_MARKERS}~${MAX_IMAGE_MARKERS}개여야 합니다.`);
  }

  for (let i = 0; i < allMarkers.length; i += 1) {
    const expected = i + 1;
    if (allMarkers[i] !== expected) {
      throw new Error(`이미지 마커는 [IMAGE_${expected}]부터 순서대로 작성해야 합니다.`);
    }
  }
}

function parseArticleResponse(rawText, { minChars, maxChars } = {}) {
  // AI의 답변을 믿고 바로 발행하지 않는다.
  // JSON 구조, 제목·본문 길이, 소제목, 이미지 위치, 태그를 모두 확인한 뒤 표준 결과로 바꾼다.
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('AI로부터 빈 응답을 받았습니다.');
  }

  let data;
  try {
    data = JSON.parse(extractJsonText(rawText));
  } catch (err) {
    throw new Error('응답이 올바른 JSON 형식이 아닙니다.');
  }

  if (typeof data.title !== 'string' || !data.title.trim()) {
    throw new Error('title 필드가 올바르지 않습니다.');
  }
  if (typeof data.body !== 'string' || !data.body.trim()) {
    throw new Error('body 필드가 올바르지 않습니다.');
  }
  if (!Array.isArray(data.imagePrompts) || data.imagePrompts.some((p) => typeof p !== 'string')) {
    throw new Error('imagePrompts 필드가 올바르지 않습니다.');
  }
  if (!Array.isArray(data.tags) || data.tags.some((t) => typeof t !== 'string')) {
    throw new Error('tags 필드가 올바르지 않습니다.');
  }

  const imagePrompts = data.imagePrompts.map((p) => p.trim());
  if (imagePrompts.some((p) => !p)) {
    throw new Error('imagePrompts 필드에 빈 문장이 포함되어 있습니다.');
  }

  validateImageMarkers(data.body, imagePrompts);

  const title = normalizeTitle(data.title);
  if (Array.from(title).length < MIN_TITLE_CHARS) {
    throw new Error(`title은 ${MIN_TITLE_CHARS}자 이상으로 작성해야 합니다.`);
  }
  if (Array.from(title).length > MAX_TITLE_CHARS) {
    throw new Error(`title은 ${MAX_TITLE_CHARS}자 이내로 작성해야 합니다.`);
  }

  const headingCount = data.body.split('\n').filter((line) => /^##\s+\S/.test(line.trim())).length;
  if (headingCount < MIN_HEADINGS || headingCount > MAX_HEADINGS) {
    throw new Error(`본문의 ## 소제목은 ${MIN_HEADINGS}~${MAX_HEADINGS}개여야 합니다. 현재 ${headingCount}개입니다.`);
  }

  const bodyLength = Array.from(data.body).length;
  if (minChars && bodyLength < minChars) {
    throw new Error(`body는 최소 ${minChars}자 이상이어야 합니다. 현재 ${bodyLength}자입니다.`);
  }
  if (maxChars && bodyLength > Math.ceil(maxChars * MAX_BODY_OVERAGE_RATIO)) {
    throw new Error(`body가 너무 깁니다. 최대 ${maxChars}자 기준을 크게 넘었습니다. 현재 ${bodyLength}자입니다.`);
  }

  const tags = normalizeTags(data.tags);
  if (tags.length < MIN_TAGS) {
    throw new Error(`중복을 제외한 태그는 최소 ${MIN_TAGS}개여야 합니다. 현재 ${tags.length}개입니다.`);
  }

  return {
    title,
    body: data.body.trim(),
    imagePrompts,
    tags,
  };
}

/**
 * AI 응답 형식이 깨졌을 때만 한 번 더 요청한다.
 * 무한 재시도로 비용이 계속 늘어나는 일을 막기 위해 최대 두 번만 시도한다.
 */
async function generateArticleWithRetry(callOnce, validationOptions = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callOnce(attempt, lastError);
    try {
      return parseArticleResponse(raw, validationOptions);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`AI 응답을 해석하지 못했습니다: ${lastError.message}`);
}

module.exports = {
  DEFAULT_TONE,
  DEFAULT_MIN_CHARS,
  DEFAULT_MAX_CHARS,
  RETRY_REMINDER,
  MIN_TITLE_CHARS,
  MAX_TITLE_CHARS,
  MIN_TAGS,
  MAX_TAGS,
  MIN_IMAGE_MARKERS,
  MAX_IMAGE_MARKERS,
  MIN_HEADINGS,
  MAX_HEADINGS,
  buildSystemPrompt,
  buildUserPrompt,
  parseArticleResponse,
  generateArticleWithRetry,
};
