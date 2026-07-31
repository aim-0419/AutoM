const fs = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { toKoreanErrorMessage } = require('../errorMessage');

// Google Gemini 이미지 생성용 어댑터다. Gemini가 준 이미지 데이터를 PNG 파일로 저장해
// 다른 이미지 공급자와 같은 결과 형태로 돌려준다.
const id = 'gemini';
const label = 'Google Gemini (Nano Banana)';
const defaultModel = 'gemini-3.1-flash-image';

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
