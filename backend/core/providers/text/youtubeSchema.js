/**
 * YouTube 영상 형식, 길이, 장면 수와 AI 대본 응답 규칙을 한곳에서 관리한다.
 * 생성된 대본이 선택한 쇼츠·롱폼 조건과 정책 보조 항목을 갖췄는지 검사한다.
 */
const { GENERAL_CONTENT_SAFETY_RULES } = require('../../contentSafety');

const FORMATS = Object.freeze({
  shorts: Object.freeze({
    id: 'shorts',
    label: '쇼츠',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    durations: Object.freeze([30, 45, 60, 90, 180]),
    minScenes: 4,
    maxScenes: 12,
  }),
  longform: Object.freeze({
    id: 'longform',
    label: '롱폼',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    durations: Object.freeze([180, 300, 480]),
    minScenes: 6,
    maxScenes: 16,
  }),
});

const CONTENT_STYLES = Object.freeze(['educational', 'problem-solving', 'comparison', 'story']);
const MIN_TAG_COUNT = 5;
const MAX_TAG_COUNT = 15;
const RETRY_REMINDER =
  '직전 응답은 YouTube JSON 형식, 장면 수 또는 대본 길이 조건을 충족하지 못했습니다. 설명이나 코드 블록 없이 JSON 객체 하나만 다시 출력하세요.';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanParagraphs(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function assertText(value, field, minimum, maximum, { allowEmpty = false, paragraphs = false } = {}) {
  const text = paragraphs ? cleanParagraphs(value) : cleanText(value);
  if (allowEmpty && !text) return '';
  const length = [...text].length;
  if (length < minimum || length > maximum) {
    throw new Error(`${field}은(는) ${minimum}~${maximum}자로 작성해야 합니다.`);
  }
  return text;
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

function normalizeRequest({ format, durationSeconds, sceneCount, contentStyle }) {
  const config = FORMATS[format];
  if (!config) throw new Error('영상 형식은 쇼츠 또는 롱폼이어야 합니다.');

  const duration = Number(durationSeconds);
  if (!Number.isInteger(duration) || !config.durations.includes(duration)) {
    throw new Error(`${config.label}에서 지원하지 않는 영상 길이입니다.`);
  }

  const scenes = Number(sceneCount);
  if (!Number.isInteger(scenes) || scenes < config.minScenes || scenes > config.maxScenes) {
    throw new Error(`${config.label} 장면 수는 ${config.minScenes}~${config.maxScenes}개여야 합니다.`);
  }

  const style = CONTENT_STYLES.includes(contentStyle) ? contentStyle : CONTENT_STYLES[0];
  return { format: config.id, durationSeconds: duration, sceneCount: scenes, contentStyle: style, config };
}

function normalizeChannelProfile({ channelTheme, targetAudience, creatorPerspective } = {}) {
  return {
    channelTheme: assertText(channelTheme, '채널 핵심 주제', 5, 200),
    targetAudience: assertText(targetAudience, '주요 시청자', 5, 200),
    creatorPerspective: assertText(creatorPerspective, '제작자 관점·경험', 0, 1000, { allowEmpty: true }),
  };
}

function normalizeRecentProjects(recentProjects) {
  if (!Array.isArray(recentProjects)) return [];
  return recentProjects
    .map((item) => ({
      keyword: cleanText(item?.keyword).slice(0, 120),
      title: cleanText(item?.title).slice(0, 100),
      originalAngle: cleanText(item?.originalAngle).slice(0, 300),
    }))
    .filter((item) => item.keyword || item.title || item.originalAngle)
    .slice(0, 20);
}

function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) throw new Error('tags는 배열이어야 합니다.');
  const tags = rawTags.map((tag) => cleanText(tag).replace(/^#+/, '')).filter(Boolean);
  if (tags.length < MIN_TAG_COUNT || tags.length > MAX_TAG_COUNT) {
    throw new Error(`태그는 ${MIN_TAG_COUNT}~${MAX_TAG_COUNT}개가 필요합니다.`);
  }
  if (tags.some((tag) => /\s/.test(tag) || [...tag].length > 30)) {
    throw new Error('태그는 공백 없이 30자 이하로 작성해야 합니다.');
  }
  if (new Set(tags.map((tag) => tag.toLocaleLowerCase('ko-KR'))).size !== tags.length) {
    throw new Error('같은 태그를 반복할 수 없습니다.');
  }
  return tags;
}

function countSpeechCharacters(text) {
  return [...String(text || '').replace(/\s/g, '')].length;
}

function buildSystemPrompt(options) {
  const request = normalizeRequest(options);
  const profile = normalizeChannelProfile(options);
  const secondsPerScene = request.durationSeconds / request.sceneCount;
  const minSceneChars = Math.max(20, Math.floor(secondsPerScene * 2));
  const maxSceneChars = Math.min(650, Math.ceil(secondsPerScene * 7));

  return `당신은 한국어 YouTube 영상의 대본과 장면 구성을 만드는 전문 에디터입니다.

목표는 ${request.config.label} ${request.durationSeconds}초 분량의 오리지널 영상입니다. 채널의 핵심 주제는 "${profile.channelTheme}"이고 주요 시청자는 "${profile.targetAudience}"입니다. 시청자에게 실제 정보나 재미를 주고, 제작자가 자신의 목소리로 녹음했을 때 자연스럽게 들리는 문장으로 작성하세요. 조회수만 노린 복제형 문구, 다른 영상이나 기사를 짜깁기한 구성, 주제만 바꾼 반복 템플릿은 만들지 마세요.

채널 주제와 영상 주제가 어떤 분야든 그대로 다루고, 건강이나 다른 특정 분야로 유도하지 마세요. 해당 분야의 시청자 수준과 사용 맥락에 맞는 설명 방식을 선택하세요.

${GENERAL_CONTENT_SAFETY_RULES}

제작자가 제공한 관점·경험은 "${profile.creatorPerspective || '제공되지 않음'}"입니다. 제공된 내용만 활용하고, 제공되지 않은 개인 경험·직업·성과·사용 후기를 지어내지 마세요. AI가 초안을 만들더라도 최종 영상에 제작자의 실제 해설과 목소리가 들어갈 수 있도록 구체적인 기여 지점을 제안하세요.

반드시 아래 JSON 객체 하나만 출력하세요.
{
  "title": "영상 제목",
  "hook": "첫 장면에서 바로 말할 핵심 도입",
  "description": "YouTube 설명란 본문. 해시태그는 넣지 마세요.",
  "tags": ["#을 뺀 태그"],
  "originalAngle": "이 영상만의 관점 또는 시청자가 얻을 구체적인 가치",
  "channelFit": "이 영상이 채널 핵심 주제와 시청자에게 맞는 구체적인 이유",
  "viewerValue": "시청자가 영상을 보고 얻게 될 교육적 또는 오락적 가치",
  "creatorContribution": "제작자가 직접 녹음하면서 더해야 할 실제 관점·설명·경험",
  "metadataPromise": "제목과 설명이 약속한 내용을 대본의 어느 흐름에서 충족하는지",
  "channelAboutDraft": "채널 핵심 주제와 주요 시청자를 정확히 설명하는 채널 소개 초안",
  "scenes": [
    {
      "onScreenText": "화면에 표시할 짧은 문구",
      "narration": "사용자가 직접 녹음할 자연스러운 대본",
      "visualPrompt": "장면용 AI 이미지를 만들 영어 프롬프트"
    }
  ],
  "callToAction": "영상 끝에 말할 자연스러운 마무리",
  "disclaimer": "건강·금융·법률처럼 주의가 필요한 경우의 짧은 고지. 필요 없으면 빈 문자열",
  "factCheckNotes": ["게시 전 사용자가 사실 확인할 핵심 주장"]
}

규칙:
1. scenes는 정확히 ${request.sceneCount}개로 작성하세요. 첫 장면은 hook, 마지막 장면은 요약과 callToAction 흐름이어야 합니다.
2. 각 narration은 대략 ${minSceneChars}~${maxSceneChars}자로, 소리 내어 읽기 쉬운 구어체로 작성하세요. 괄호형 연출 지시, 이모지, 해시태그를 넣지 마세요.
3. onScreenText는 4~36자로 작성하고 narration 전체를 그대로 복사하지 마세요.
4. visualPrompt는 영어 20~600자로 작성하세요. 실존 인물, 유명인, 실제 사건의 허위 장면, 브랜드, 로고, 저작권 캐릭터, 읽을 수 있는 글자나 숫자를 포함하지 마세요. 독창적인 비사실적 편집 일러스트를 요청하세요.
5. 확인할 수 없는 개인 체험을 지어내거나 치료·수익·효과를 보장하지 마세요. 건강·금융·법률 주제는 일반 정보로 표현하고 전문가 판단을 대체하지 않는 고지를 작성하세요.
6. title은 내용과 일치해야 하며 충격, 무조건, 100%처럼 오해를 만드는 낚시성 표현을 피하세요.
7. description은 120~1,800자, tags는 서로 다른 5~15개로 작성하세요.
8. factCheckNotes에는 날짜, 수치, 연구 결과처럼 업로드 전에 확인할 내용만 0~8개 작성하고 출처를 지어내지 마세요.
9. 영상 비율은 ${request.config.aspectRatio}입니다. 이미지의 중요한 피사체가 중앙 안전 영역에 오도록 visualPrompt를 작성하세요.
10. channelFit, viewerValue, creatorContribution, metadataPromise는 각각 20~400자로 구체적으로 작성하세요. 제목·썸네일 첫 화면·설명에서 약속한 내용은 실제 대본에서 다뤄야 합니다.
11. channelAboutDraft는 40~500자로 작성하고 채널의 실제 핵심 주제와 주요 시청자만 설명하세요. 업로드 빈도, 경력, 성과처럼 제공되지 않은 사실을 만들지 마세요.`;
}

function buildUserPrompt({ keyword, contentStyle, channelTheme, targetAudience, creatorPerspective, recentProjects }) {
  const styleLabels = {
    educational: '정보형',
    'problem-solving': '문제 해결형',
    comparison: '비교형',
    story: '스토리형',
  };
  const profile = normalizeChannelProfile({ channelTheme, targetAudience, creatorPerspective });
  const recent = normalizeRecentProjects(recentProjects);
  const recentText = recent.length
    ? recent
        .map(
          (item, index) =>
            `${index + 1}. 주제: ${item.keyword || '-'} | 제목: ${item.title || '-'} | 고유 관점: ${item.originalAngle || '-'}`
        )
        .join('\n')
    : '비교할 최근 생성 기록 없음';

  return `주제: "${cleanText(keyword)}"
구성 방식: ${styleLabels[contentStyle] || styleLabels.educational}
채널 핵심 주제: ${profile.channelTheme}
주요 시청자: ${profile.targetAudience}
제작자 관점·경험: ${profile.creatorPerspective || '제공되지 않음'}

최근 생성 영상:
${recentText}

최근 영상과 제목, 도입, 장면 순서, 고유 관점을 되풀이하지 말고 이 주제에 맞는 새로운 시청자 가치를 만드세요. 이 주제로 대본과 장면을 작성하세요.`;
}

function parseYoutubeProjectResponse(rawText, options) {
  const request = normalizeRequest(options);
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(rawText));
  } catch (error) {
    throw new Error(`YouTube 프로젝트 JSON을 읽지 못했습니다: ${error.message}`);
  }

  if (!Array.isArray(parsed?.scenes) || parsed.scenes.length !== request.sceneCount) {
    throw new Error(`장면은 정확히 ${request.sceneCount}개가 필요합니다.`);
  }

  const scenes = parsed.scenes.map((scene, index) => ({
    index: index + 1,
    onScreenText: assertText(scene?.onScreenText, `${index + 1}번 장면 화면 문구`, 4, 36),
    narration: assertText(scene?.narration, `${index + 1}번 장면 대본`, 20, 650, { paragraphs: true }),
    visualPrompt: assertText(scene?.visualPrompt, `${index + 1}번 장면 이미지 설명`, 20, 600),
  }));

  const normalizedScreenTexts = scenes.map((scene) => scene.onScreenText.toLocaleLowerCase('ko-KR'));
  if (new Set(normalizedScreenTexts).size !== normalizedScreenTexts.length) {
    throw new Error('장면 화면 문구가 반복됩니다. 장면마다 다른 핵심 문구가 필요합니다.');
  }

  const narrationLength = scenes.reduce((sum, scene) => sum + countSpeechCharacters(scene.narration), 0);
  const minimumNarrationLength = Math.floor(request.durationSeconds * 2);
  const maximumNarrationLength = Math.ceil(request.durationSeconds * 7);
  if (narrationLength < minimumNarrationLength || narrationLength > maximumNarrationLength) {
    throw new Error(
      `전체 대본은 ${request.durationSeconds}초 영상에 맞게 공백 제외 ${minimumNarrationLength}~${maximumNarrationLength}자로 작성해야 합니다.`
    );
  }

  const factCheckNotes = Array.isArray(parsed?.factCheckNotes)
    ? parsed.factCheckNotes
        .map((note) => cleanText(note))
        .filter(Boolean)
        .slice(0, 8)
        .map((note, index) => assertText(note, `${index + 1}번 사실 확인 항목`, 5, 240))
    : [];

  return {
    title: assertText(parsed?.title, '영상 제목', 10, 80),
    hook: assertText(parsed?.hook, '도입 문장', 10, 140),
    description: assertText(parsed?.description, '영상 설명', 120, 1800, { paragraphs: true }),
    tags: normalizeTags(parsed?.tags),
    originalAngle: assertText(parsed?.originalAngle, '영상 고유 관점', 20, 300),
    channelFit: assertText(parsed?.channelFit, '채널 주제 적합성', 20, 400),
    viewerValue: assertText(parsed?.viewerValue, '시청자 가치', 20, 400),
    creatorContribution: assertText(parsed?.creatorContribution, '제작자 기여', 20, 400),
    metadataPromise: assertText(parsed?.metadataPromise, '메타데이터 일치 설명', 20, 400),
    channelAboutDraft: assertText(parsed?.channelAboutDraft, '채널 소개 초안', 40, 500, {
      paragraphs: true,
    }),
    scenes,
    callToAction: assertText(parsed?.callToAction, '마무리 문장', 8, 120),
    disclaimer: assertText(parsed?.disclaimer, '주의 고지', 0, 300, { allowEmpty: true }),
    factCheckNotes,
    narrationLength,
  };
}

async function generateYoutubeProjectWithRetry(generateRaw, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await generateRaw(attempt, lastError);
    try {
      return parseYoutubeProjectResponse(raw, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('YouTube 대본과 장면을 생성하지 못했습니다.');
}

module.exports = {
  FORMATS,
  CONTENT_STYLES,
  RETRY_REMINDER,
  normalizeRequest,
  normalizeChannelProfile,
  normalizeRecentProjects,
  buildSystemPrompt,
  buildUserPrompt,
  parseYoutubeProjectResponse,
  generateYoutubeProjectWithRetry,
  countSpeechCharacters,
};
