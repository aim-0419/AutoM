const fs = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { toKoreanErrorMessage } = require('../errorMessage');

/**
 * [Google Gemini 이미지 생성 어댑터]
 *
 * 비개발자를 위한 설명:
 * - OpenAI 이미지 어댑터와 하는 일이 같습니다. 설명문을 보내 그림을 받고 PNG로 저장합니다.
 * - Gemini는 호출 방식이 OpenAI와 다르지만, 이 파일이 그 차이를 흡수하기 때문에
 *   프로그램의 나머지 부분은 "그림을 만들어 이 경로에 저장해줘" 한 가지만 부르면 됩니다.
 */
const id = 'gemini'; // 프로그램 내부 식별 이름
const label = 'Google Gemini (Nano Banana)'; // 설정 화면 표시 이름
const defaultModel = 'gemini-3.1-flash-image'; // 기본 이미지 모델

async function testConnection({ apiKey, model }) {
  // 선택한 모델 정보를 실제로 조회해 설정값을 사전에 확인한다.
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

async function generateImage({ prompt, model, apiKey, outputPath }) {
  // AI 응답의 Base64 이미지를 파일로 저장하면 발행 단계가 공급자 종류를 신경 쓰지 않아도 된다.
  if (!apiKey) {
    throw new Error('API 키가 설정되지 않았습니다. 설정에서 키를 입력해주세요.');
  }

  const client = new GoogleGenAI({ apiKey });

  try {
    const interaction = await client.interactions.create({
      model: model || defaultModel,
      input: prompt,
    });

    const imageData = interaction.output_image;
    if (!imageData?.data) {
      throw new Error('이미지 생성 결과를 받지 못했습니다.');
    }

    const buffer = Buffer.from(imageData.data, 'base64');
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
