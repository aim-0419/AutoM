const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
const { toKoreanErrorMessage } = require('../errorMessage');

/**
 * [OpenAI 이미지 생성 어댑터]
 *
 * 비개발자를 위한 설명:
 * - 영어 설명문(prompt)을 보내면 그림을 만들어 돌려받고, 그것을 PNG 파일로 저장합니다.
 * - AI는 그림을 '파일'이 아니라 Base64라는 긴 문자열 형태로 보내줍니다.
 *   (그림을 글자로 바꿔 인터넷으로 전송하는 방식)
 *   그래서 여기서 그 문자열을 다시 그림 파일로 복원해 저장합니다.
 * - 저장된 PNG는 미리보기 화면과 네이버 업로드에서 그대로 사용됩니다.
 */
const id = 'openai'; // 프로그램 내부 식별 이름
const label = 'OpenAI (GPT Image)'; // 설정 화면 표시 이름
const defaultModel = 'gpt-image-2'; // 기본 이미지 모델
const defaultSize = '1024x1024'; // 기본 이미지 크기 (정사각형)

async function testConnection({ apiKey, model }) {
  // 이미지 생성 전에 API 키와 지정 모델을 조회해 설정 문제를 먼저 알려 준다.
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

async function generateImage({ prompt, size, model, apiKey, outputPath }) {
  // 이미지 API 결과는 문자열이 아니라 Base64 데이터다.
  // 이를 파일로 바꿔야 미리보기와 네이버 업로드에서 같은 이미지를 사용할 수 있다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new OpenAI({ apiKey });

  try {
    const response = await client.images.generate({
      model: model || defaultModel,
      prompt,
      size: size || defaultSize,
    });

    // 첫 번째 생성 결과만 사용한다. 한 본문 위치에는 이미지 파일 하나만 필요하다.
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('이미지 생성 결과를 받지 못했습니다.');
    }

    const buffer = Buffer.from(b64, 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  } catch (err) {
    if (err.status) {
      throw new Error(toKoreanErrorMessage(err));
    }
    throw err;
  }
}

module.exports = { id, label, defaultModel, testConnection, generateImage };
