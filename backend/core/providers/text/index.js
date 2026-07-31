const anthropic = require('./anthropic');
const openai = require('./openai');
const gemini = require('./gemini');

// 선택 가능한 텍스트 AI를 한곳에 모아 두는 목록이다.
// 새로운 공급자를 추가할 때는 이 목록에 넣으면 설정 화면과 생성 과정에서 함께 인식한다.
const providers = { anthropic, openai, gemini };

function list() {
  // 화면에는 내부 구현 대신 이름·기본 모델처럼 선택에 필요한 정보만 제공한다.
  return Object.values(providers).map(({ id, label, defaultModel }) => ({ id, label, defaultModel }));
}

function get(providerId) {
  // 등록되지 않은 공급자를 임의로 실행하지 않고, 이해하기 쉬운 오류로 중단한다.
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`알 수 없는 텍스트 프로바이더입니다: ${providerId}`);
  }
  return provider;
}

module.exports = { list, get };
