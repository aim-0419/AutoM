const openai = require('./openai');
const gemini = require('./gemini');

// 선택 가능한 이미지 AI를 한곳에 모아 두는 목록이다.
// 여기서 꺼낸 공급자는 모두 testConnection과 generateImage 기능을 제공한다.
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
