/**
 * [설정값 정리기 - 이상한 값이 들어와도 프로그램이 멈추지 않게 한다]
 *
 * 비개발자를 위한 설명:
 * - 설정 파일은 컴퓨터에 저장된 파일이라, 프로그램을 업데이트했거나 파일이 손상되면
 *   예상과 다른 값이 들어 있을 수 있습니다. (예: 발행 간격에 -5 또는 "abc")
 * - 이 파일은 설정을 불러올 때마다 모든 값을 한 번씩 훑어서
 *   "허용된 범위 안의 올바른 값"으로 바꿔줍니다. 잘못된 값은 기본값으로 되돌립니다.
 * - 덕분에 어떤 값이 들어 있어도 프로그램이 오류로 꺼지지 않습니다.
 */

/** 숫자를 정해진 범위 안으로 강제한다. 숫자가 아니면 기본값을 쓴다. (예: 5 → 최소 30이면 30) */
function clampInteger(value, minimum, maximum, fallback) {
  // 숫자가 아니면 기본값을 쓰고, 숫자라면 허용 범위 안으로만 맞춘다.
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function safeString(value, fallback = '', maxLength = 500) {
  // 설정 파일에서 지나치게 긴 문자열이나 예상 밖의 자료형이 들어오는 것을 막는다.
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeProviderSettings(candidate, defaults) {
  // 텍스트 AI와 이미지 AI는 같은 저장 구조를 사용하므로 공통으로 정리한다.
  // 등록되지 않은 공급자 이름은 임의로 쓰지 않고 기본 공급자로 되돌린다.
  const providerIds = Object.keys(defaults.apiKeys);
  const provider = providerIds.includes(candidate?.provider) ? candidate.provider : defaults.provider;
  const apiKeys = {};
  const models = {};

  for (const providerId of providerIds) {
    apiKeys[providerId] =
      typeof candidate?.apiKeys?.[providerId] === 'string'
        ? candidate.apiKeys[providerId]
        : defaults.apiKeys[providerId];
    models[providerId] = safeString(
      candidate?.models?.[providerId],
      defaults.models[providerId],
      120
    );
  }

  return { provider, apiKeys, models };
}

/**
 * 저장된 설정 전체를 항목별로 검사해 안전한 값으로 정리한다.
 *
 * 특히 아래 두 값은 화면을 거치지 않고 파일이 직접 수정되더라도 반드시 제한을 지킨다.
 *  · 자동 발행 간격: 30~1440분 (30분보다 짧으면 계정 제재 위험)
 *  · 이미지 장수   : 2~4장     (그 이상은 비용·시간 부담이 큼)
 */
function normalizeSettings(candidate, defaults) {
  // 저장한 설정 전체를 한 번 더 검사한다.
  // 특히 자동 발행 간격(30~1440분)과 이미지 수(2~4장)는 화면 밖에서 저장되어도 제한을 유지한다.
  const instagramDefaults = defaults.instagram || { loggedIn: false, username: '' };
  const youtubeProfileDefaults = defaults.youtubeProfile || {
    channelTheme: '',
    targetAudience: '',
    creatorPerspective: '',
  };
  return {
    text: normalizeProviderSettings(candidate?.text, defaults.text),
    image: normalizeProviderSettings(candidate?.image, defaults.image),
    naver: {
      blogId: safeString(candidate?.naver?.blogId, defaults.naver.blogId, 40),
      loggedIn: candidate?.naver?.loggedIn === true,
    },
    instagram: {
      loggedIn: candidate?.instagram?.loggedIn === true,
      username: safeString(candidate?.instagram?.username, instagramDefaults.username, 50),
    },
    youtubeProfile: {
      channelTheme: safeString(
        candidate?.youtubeProfile?.channelTheme,
        youtubeProfileDefaults.channelTheme,
        200
      ),
      targetAudience: safeString(
        candidate?.youtubeProfile?.targetAudience,
        youtubeProfileDefaults.targetAudience,
        200
      ),
      creatorPerspective: safeString(
        candidate?.youtubeProfile?.creatorPerspective,
        youtubeProfileDefaults.creatorPerspective,
        1000
      ),
    },
    publishDefaults: {
      category: safeString(candidate?.publishDefaults?.category, defaults.publishDefaults.category, 100),
      visibility: ['public', 'private'].includes(candidate?.publishDefaults?.visibility)
        ? candidate.publishDefaults.visibility
        : defaults.publishDefaults.visibility,
      autoIntervalMinutes: clampInteger(
        candidate?.publishDefaults?.autoIntervalMinutes,
        30,
        1440,
        defaults.publishDefaults.autoIntervalMinutes
      ),
      maxImages: clampInteger(candidate?.publishDefaults?.maxImages, 2, 4, defaults.publishDefaults.maxImages),
      insertDisclaimer: candidate?.publishDefaults?.insertDisclaimer !== false,
    },
    outputFolder: safeString(candidate?.outputFolder, defaults.outputFolder, 1000) || defaults.outputFolder,
  };
}

function isValidNaverBlogId(value) {
  // 블로그 ID는 발행 주소와 로그인 확인에 쓰이므로 네이버 ID 형식만 허용한다.
  return value === '' || /^[a-z0-9_-]{5,20}$/i.test(String(value || '').trim());
}

module.exports = { clampInteger, isValidNaverBlogId, normalizeSettings };
