const Anthropic = require('@anthropic-ai/sdk');
const { toKoreanErrorMessage } = require('../errorMessage');
const {
  DEFAULT_TONE,
  DEFAULT_MIN_CHARS,
  DEFAULT_MAX_CHARS,
  RETRY_REMINDER,
  buildSystemPrompt,
  buildUserPrompt,
  generateArticleWithRetry,
} = require('./articleSchema');
const keywordSchema = require('./keywordSchema');
const instagramSchema = require('./instagramSchema');
const youtubeSchema = require('./youtubeSchema');

/**
 * [Claude(Anthropic) 연결 어댑터]
 *
 * 비개발자를 위한 설명:
 * - '어댑터'는 해외 전자제품에 쓰는 플러그 어댑터와 같은 뜻입니다.
 *   Claude만의 사용법을 이 프로그램의 공통 규격에 맞춰 끼워주는 역할을 합니다.
 * - openai.js, gemini.js도 같은 4가지 기능을 제공하므로, 프로그램의 나머지 부분은
 *   지금 어떤 AI를 쓰는지 전혀 신경 쓰지 않아도 됩니다.
 *     · testConnection            : API 키 확인
 *     · generateArticle           : 블로그 글 쓰기
 *     · generateKeywordSuggestions: 키워드 추천
 *     · generateInstagramCarousel : 인스타 카드 문구 쓰기
 *     · generateYoutubeProject    : 유튜브 대본 쓰기
 * - 실제 글의 규칙(형식·길이·안전 기준)은 이 파일이 아니라 articleSchema.js 등이 정합니다.
 *   이 파일은 "그 주문서를 Claude에게 전달하고 답변을 받아오는" 일만 합니다.
 */
const id = 'anthropic'; // 프로그램 내부에서 쓰는 식별 이름
const label = 'Claude (Anthropic)'; // 설정 화면에 표시되는 이름
const defaultModel = 'claude-sonnet-5'; // 사용자가 모델을 지정하지 않았을 때 쓰는 기본 모델

async function testConnection({ apiKey, model }) {
  // 설정 화면의 '연결 테스트' 버튼이 부르는 기능이다.
  // 실제 글을 만들지 않고 모델 정보만 조회해, 키와 모델 이름이 맞는지 저렴하게 확인한다.
  if (!apiKey) {
    return { success: false, message: 'API 키를 입력해주세요.' };
  }
  try {
    const client = new Anthropic({ apiKey });
    await client.models.retrieve(model || defaultModel);
    return { success: true, message: '연결에 성공했습니다.' };
  } catch (err) {
    return { success: false, message: toKoreanErrorMessage(err) };
  }
}

async function generateArticle({
  keyword,
  tone = DEFAULT_TONE,
  minChars = DEFAULT_MIN_CHARS,
  maxChars = DEFAULT_MAX_CHARS,
  model,
  apiKey,
}) {
  // Claude 응답에서 실제 텍스트 블록만 꺼낸 뒤 공통 JSON 검사기로 넘긴다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt({ tone, minChars, maxChars });
  const userPrompt = buildUserPrompt({ keyword });

  try {
    return await generateArticleWithRetry(
      async (attempt, lastError) => {
        const content =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.messages.create({
          model: model || defaultModel,
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        });
        const textBlock = response.content.find((block) => block.type === 'text');
        return textBlock ? textBlock.text : '';
      },
      { minChars, maxChars }
    );
  } catch (err) {
    if (err.status) {
      throw new Error(toKoreanErrorMessage(err));
    }
    throw err;
  }
}

async function generateKeywordSuggestions({ count = 5, excludeKeywords = [], model, apiKey }) {
  // 이미 사용한 키워드를 제외한 추천 목록을 요청하고, 응답 형식을 공통 규칙으로 검증한다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = keywordSchema.buildSystemPrompt();
  const userPrompt = keywordSchema.buildUserPrompt({ count, excludeKeywords });

  try {
    return await keywordSchema.generateKeywordSuggestionsWithRetry(async (attempt) => {
      const content = attempt === 0 ? userPrompt : `${userPrompt}\n\n${keywordSchema.RETRY_REMINDER}`;
      const response = await client.messages.create({
        model: model || defaultModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });
      const textBlock = response.content.find((block) => block.type === 'text');
      return textBlock ? textBlock.text : '';
    });
  } catch (err) {
    if (err.status) {
      throw new Error(toKoreanErrorMessage(err));
    }
    throw err;
  }
}

/** 인스타그램 카드뉴스의 문구(카드별 제목·본문·해시태그)를 만든다. */
async function generateInstagramCarousel({ keyword, cardCount, model, apiKey }) {
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = instagramSchema.buildSystemPrompt({ cardCount });
  const userPrompt = instagramSchema.buildUserPrompt({ keyword });

  try {
    return await instagramSchema.generateInstagramCarouselWithRetry(
      async (attempt, lastError) => {
        const content =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${instagramSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.messages.create({
          model: model || defaultModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        });
        const textBlock = response.content.find((block) => block.type === 'text');
        return textBlock ? textBlock.text : '';
      },
      { cardCount }
    );
  } catch (err) {
    if (err.status) throw new Error(toKoreanErrorMessage(err));
    throw err;
  }
}

/**
 * 유튜브 영상 기획안을 만든다.
 * 제목·대본·장면별 화면 설명·자막·해시태그를 한 번에 받아온다.
 * 채널 정보(주제/시청자/관점)와 최근 만든 영상 목록을 함께 보내 중복을 피한다.
 */
async function generateYoutubeProject({
  keyword,
  format,
  durationSeconds,
  sceneCount,
  contentStyle,
  channelTheme,
  targetAudience,
  creatorPerspective,
  recentProjects,
  model,
  apiKey,
}) {
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정 화면에서 입력해 주세요.');
  }

  const client = new Anthropic({ apiKey });
  const options = {
    format,
    durationSeconds,
    sceneCount,
    contentStyle,
    channelTheme,
    targetAudience,
    creatorPerspective,
  };
  const systemPrompt = youtubeSchema.buildSystemPrompt(options);
  const userPrompt = youtubeSchema.buildUserPrompt({
    keyword,
    contentStyle,
    channelTheme,
    targetAudience,
    creatorPerspective,
    recentProjects,
  });

  try {
    return await youtubeSchema.generateYoutubeProjectWithRetry(
      async (attempt, lastError) => {
        const content =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${youtubeSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.messages.create({
          model: model || defaultModel,
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: 'user', content }],
        });
        const textBlock = response.content.find((block) => block.type === 'text');
        return textBlock ? textBlock.text : '';
      },
      options
    );
  } catch (err) {
    if (err.status) throw new Error(toKoreanErrorMessage(err));
    throw err;
  }
}

module.exports = {
  id,
  label,
  defaultModel,
  testConnection,
  generateArticle,
  generateKeywordSuggestions,
  generateInstagramCarousel,
  generateYoutubeProject,
};
