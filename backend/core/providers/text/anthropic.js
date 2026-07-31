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

// Anthropic(Claude)용 연결 어댑터다. 다른 텍스트 AI와 결과 형식을 맞춰
// 화면과 발행 과정이 공급자마다 달라지지 않도록 한다.
const id = 'anthropic';
const label = 'Claude (Anthropic)';
const defaultModel = 'claude-sonnet-5';

async function testConnection({ apiKey, model }) {
  // 저장 전에도 모델 조회를 해 API 키와 모델 이름의 조합을 확인할 수 있게 한다.
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
