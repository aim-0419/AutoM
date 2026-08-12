/**
 * [이미지 AI 목록 - 그림을 만들어 줄 AI를 고르는 곳]
 *
 * 비개발자를 위한 설명:
 * - 이미지 생성은 OpenAI 또는 Google Gemini 중에서 고를 수 있습니다.
 *   (글쓰기 AI와 따로 선택하므로, 글은 Claude로 쓰고 이미지는 OpenAI로 만들 수도 있습니다)
 * - 어느 쪽을 고르든 프로그램 입장에서는 사용법이 같습니다.
 *   · testConnection : API 키가 제대로 동작하는지 확인
 *   · generateImage  : 설명글을 주면 PNG 파일을 만들어 저장
 */
const openai = require('./openai');
const gemini = require('./gemini');

const providers = { openai, gemini };

function list() {
  // 설정 화면에 표시할 최소한의 정보만 반환한다.
  return Object.values(providers).map(({ id, label, defaultModel }) => ({ id, label, defaultModel }));
}

function get(providerId) {
  // 잘못된 공급자 ID가 저장되어 있어도 엉뚱한 API 호출을 하지 않게 막는다.
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`알 수 없는 이미지 프로바이더입니다: ${providerId}`);
  }
  return provider;
}

module.exports = { list, get };
