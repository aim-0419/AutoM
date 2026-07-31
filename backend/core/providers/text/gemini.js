const { GoogleGenAI } = require('@google/genai');
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

// Google Gemini용 연결 어댑터다. Gemini의 호출 문법을 이 파일 안에만 두고,
// 나머지 프로그램은 모든 텍스트 AI를 동일한 방식으로 사용한다.
const id = 'gemini';
const label = 'Google Gemini';
const defaultModel = 'gemini-3.5-flash';

async function testConnection({ apiKey, model }) {
  // 실제 모델 정보를 조회해 입력한 키와 모델이 작동하는지 확인한다.
  if (!apiKey) {
    return { success: false, message: 'API 키를 입력해주세요.' };
  }
  try {
    const client = new GoogleGenAI({ apiKey });
    await client.models.get({ model: model || defaultModel });
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
  // 생성 결과는 바로 쓰지 않고, 공통 검사기가 제목·본문·이미지 위치를 먼저 확인한다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSystemPrompt({ tone, minChars, maxChars });
  const userPrompt = buildUserPrompt({ keyword });

  try {
    return await generateArticleWithRetry(
      async (attempt, lastError) => {
        const contents =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.models.generateContent({
          model: model || defaultModel,
          contents,
          config: {
            systemInstruction: systemPrompt,
          },
        });
        return response.text || '';
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
  // 키워드 자동 추천은 글 생성과 달리 JSON 배열만 허용한다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new GoogleGenAI({ apiKey });
  const systemPrompt = keywordSchema.buildSystemPrompt();
  const userPrompt = keywordSchema.buildUserPrompt({ count, excludeKeywords });

  try {
    return await keywordSchema.generateKeywordSuggestionsWithRetry(async (attempt) => {
      const contents = attempt === 0 ? userPrompt : `${userPrompt}\n\n${keywordSchema.RETRY_REMINDER}`;
      const response = await client.models.generateContent({
        model: model || defaultModel,
        contents,
        config: {
          systemInstruction: systemPrompt,
        },
      });
      return response.text || '';
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

  const client = new GoogleGenAI({ apiKey });
  const systemPrompt = instagramSchema.buildSystemPrompt({ cardCount });
  const userPrompt = instagramSchema.buildUserPrompt({ keyword });

  try {
    return await instagramSchema.generateInstagramCarouselWithRetry(
      async (attempt, lastError) => {
        const contents =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${instagramSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.models.generateContent({
          model: model || defaultModel,
          contents,
          config: { systemInstruction: systemPrompt },
        });
        return response.text || '';
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

  const client = new GoogleGenAI({ apiKey });
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
        const contents =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${youtubeSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.models.generateContent({
          model: model || defaultModel,
          contents,
          config: { systemInstruction: systemPrompt },
        });
        return response.text || '';
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
