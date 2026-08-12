const OpenAI = require('openai');
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
 * [OpenAI(ChatGPT) 연결 어댑터]
 *
 * 비개발자를 위한 설명:
 * - anthropic.js(Claude), gemini.js(Google)와 하는 일이 완전히 같습니다.
 *   다른 점은 오직 'OpenAI 서비스를 부르는 방법'뿐입니다.
 * - 글의 규칙과 검수 기준은 articleSchema.js 등 공통 파일이 정하므로,
 *   어떤 AI를 골라도 결과물의 형식과 품질 기준은 동일합니다.
 */
const id = 'openai'; // 프로그램 내부 식별 이름
const label = 'OpenAI (GPT)'; // 설정 화면 표시 이름
const defaultModel = 'gpt-5.5'; // 기본 모델

async function testConnection({ apiKey, model }) {
  // 실제 모델 목록에 한 번 조회해, 키와 선택한 모델이 사용 가능한지 빠르게 확인한다.
  if (!apiKey) {
    return { success: false, message: 'API 키를 입력해주세요.' };
  }
  try {
    const client = new OpenAI({ apiKey });
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
  // 공통 프롬프트와 응답 검사는 articleSchema에 맡기고, 이 파일은 OpenAI 호출 방식만 담당한다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = buildSystemPrompt({ tone, minChars, maxChars });
  const userPrompt = buildUserPrompt({ keyword });

  try {
    return await generateArticleWithRetry(
      async (attempt, lastError) => {
        const input =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.responses.create({
          model: model || defaultModel,
          instructions: systemPrompt,
          input,
        });
        return response.output_text || '';
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
  // 자동 추천도 글 생성과 같은 모델을 쓰되, 키워드 전용 형식 검사를 거친다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new OpenAI({ apiKey });
  const systemPrompt = keywordSchema.buildSystemPrompt();
  const userPrompt = keywordSchema.buildUserPrompt({ count, excludeKeywords });

  try {
    return await keywordSchema.generateKeywordSuggestionsWithRetry(async (attempt) => {
      const input = attempt === 0 ? userPrompt : `${userPrompt}\n\n${keywordSchema.RETRY_REMINDER}`;
      const response = await client.responses.create({
        model: model || defaultModel,
        instructions: systemPrompt,
        input,
      });
      return response.output_text || '';
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

  const client = new OpenAI({ apiKey });
  const systemPrompt = instagramSchema.buildSystemPrompt({ cardCount });
  const userPrompt = instagramSchema.buildUserPrompt({ keyword });

  try {
    return await instagramSchema.generateInstagramCarouselWithRetry(
      async (attempt, lastError) => {
        const input =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${instagramSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.responses.create({
          model: model || defaultModel,
          instructions: systemPrompt,
          input,
        });
        return response.output_text || '';
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

  const client = new OpenAI({ apiKey });
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
        const input =
          attempt === 0
            ? userPrompt
            : `${userPrompt}\n\n${youtubeSchema.RETRY_REMINDER}\n수정할 문제: ${lastError?.message || '형식 오류'}`;
        const response = await client.responses.create({
          model: model || defaultModel,
          instructions: systemPrompt,
          input,
        });
        return response.output_text || '';
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
