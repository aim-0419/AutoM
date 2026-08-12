/**
 * [AI 오류 번역기 - 영어 기술 오류를 한국어 안내로 바꾼다]
 *
 * 비개발자를 위한 설명:
 * - AI 서비스에서 오류가 나면 "401 Unauthorized" 같은 영어 코드가 돌아옵니다.
 *   그대로 보여주면 사용자는 무엇을 고쳐야 할지 알 수 없습니다.
 * - 그래서 오류 번호를 보고 "무엇을 하면 되는지"를 한국어로 알려줍니다.
 *     401/403 → 키가 잘못됨          → 설정에서 키 확인
 *     404     → 모델 이름이 틀림      → 모델명 확인
 *     429     → 너무 많이 요청함      → 잠시 후 재시도
 *     500번대 → AI 회사 서버 문제     → 잠시 후 재시도
 *     결제 관련 → 한도 초과           → 결제·크레딧 확인
 * - 세 AI 회사 모두 오류에 status(번호)를 담아 주기 때문에 한 곳에서 공통 처리할 수 있습니다.
 */
function toKoreanErrorMessage(err) {
  const status = err?.status ?? err?.response?.status;
  const code = String(err?.code ?? err?.error?.code ?? err?.response?.data?.error?.code ?? '');
  const rawMessage = String(err?.message ?? err?.error?.message ?? err?.response?.data?.error?.message ?? '');

  // 결제 상한과 순간적인 호출 속도 제한은 해결 방법이 다르다.
  // OpenAI는 결제 잔액 부족도 429로 보내는 경우가 있어 상태 코드보다 오류 내용을 먼저 확인한다.
  if (
    /insufficient_quota|billing_hard_limit|billing hard limit|credit balance|quota.*billing/i.test(
      `${code} ${rawMessage}`
    )
  ) {
    return 'API 결제 한도에 도달했습니다. 해당 AI 공급자의 결제 설정에서 사용 한도나 크레딧을 확인해주세요.';
  }

  if (status === 401 || status === 403) {
    return 'API 키가 유효하지 않습니다. 설정에서 키를 확인해주세요.';
  }
  if (status === 404) {
    return '모델을 찾을 수 없습니다. 모델명을 확인해주세요.';
  }
  if (status === 429) {
    return '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'AI 서비스에 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }

  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(rawMessage)) {
    return '네트워크 연결을 확인해주세요.';
  }

  return rawMessage ? `오류가 발생했습니다: ${rawMessage}` : '알 수 없는 오류가 발생했습니다.';
}

module.exports = { toKoreanErrorMessage };
