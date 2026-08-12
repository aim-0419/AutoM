/**
 * [글쓰기 AI 목록 - 어떤 AI를 쓸지 고르는 곳]
 *
 * 비개발자를 위한 설명:
 * - 이 프로그램은 글쓰기 AI로 Claude(Anthropic), ChatGPT(OpenAI), Gemini(Google) 셋 중
 *   하나를 골라 쓸 수 있습니다. 사용자는 설정 화면에서 API 키를 넣은 회사를 선택합니다.
 * - 세 회사는 서로 사용법이 다르지만, 이 프로그램 안에서는 전부 똑같은 방식으로 부를 수 있도록
 *   각각 별도의 '어댑터' 파일(anthropic.js / openai.js / gemini.js)로 감싸두었습니다.
 *   덕분에 나중에 AI를 바꿔도 나머지 코드는 손댈 필요가 없습니다.
 * - 새 AI 회사를 추가하려면 어댑터 파일을 하나 만들고 아래 목록에 등록하면 됩니다.
 */
const anthropic = require('./anthropic');
const openai = require('./openai');
const gemini = require('./gemini');

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
