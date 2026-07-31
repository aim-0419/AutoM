const fs = require('node:fs');
const path = require('node:path');
const OpenAI = require('openai');
const { toKoreanErrorMessage } = require('../errorMessage');

// OpenAI 이미지 생성용 어댑터다. AI가 돌려준 Base64 이미지 데이터를 실제 PNG 파일로 저장한다.
const id = 'openai';
const label = 'OpenAI (GPT Image)';
const defaultModel = 'gpt-image-2';
const defaultSize = '1024x1024';

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
