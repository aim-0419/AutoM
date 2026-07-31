// 사용자가 API 키를 발급·관리할 수 있는 공급자별 공식 페이지다.
// 화면에서 임의 주소를 넘겨도 열리지 않도록 공급자 ID와 고정 주소만 연결한다.
const API_KEY_PAGES = Object.freeze({
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://platform.claude.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
});

function getApiKeyPageUrl(providerId) {
  const url = API_KEY_PAGES[String(providerId || '').trim().toLocaleLowerCase()];
  if (!url) {
    throw new Error('지원하지 않는 AI 공급자의 키 발급 페이지입니다.');
  }
  return url;
}

module.exports = { API_KEY_PAGES, getApiKeyPageUrl };
