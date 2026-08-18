/**
 * [설정 보관함 - 사용자의 모든 설정과 API 키를 안전하게 저장]
 *
 * 비개발자를 위한 설명:
 * - 사용자가 설정 화면에서 입력한 값(AI API 키, 블로그 ID, 저장 폴더 등)을 컴퓨터에 보관합니다.
 * - API 키는 유료 서비스의 '비밀번호'와 같아서 그냥 텍스트로 저장하면 위험합니다.
 *   그래서 Windows의 자격 증명 저장소(safeStorage)로 암호화해 `settings.dat` 파일에 넣습니다.
 *   → 파일을 그대로 열어봐도 알아볼 수 없는 암호문만 보입니다.
 * - 저장 위치는 사용자 AppData 폴더이며, 블로그 앱과 Creator 앱은 서로 다른 폴더를 써서
 *   설정이 섞이지 않습니다.
 */
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const textProviders = require('../core/providers/text');
const imageProviders = require('../core/providers/image');
const { normalizeSettings } = require('../core/settingsValidation');

function settingsFilePath() {
  // 개발 중이든 설치한 앱이든 사용자별 AppData 폴더에 같은 설정 파일을 사용한다.
  return path.join(app.getPath('userData'), 'settings.dat');
}

function getDefaultSettings() {
  // 처음 설치했거나 저장된 파일을 읽지 못했을 때 사용할 안전한 기본값이다.
  const textDefaults = textProviders.list();
  const imageDefaults = imageProviders.list();

  return {
    text: {
      provider: textDefaults[0].id,
      apiKeys: Object.fromEntries(textDefaults.map((p) => [p.id, ''])),
      models: Object.fromEntries(textDefaults.map((p) => [p.id, p.defaultModel])),
    },
    image: {
      provider: imageDefaults[0].id,
      apiKeys: Object.fromEntries(imageDefaults.map((p) => [p.id, ''])),
      models: Object.fromEntries(imageDefaults.map((p) => [p.id, p.defaultModel])),
    },
    naver: {
      blogId: '', // 내 블로그 주소의 아이디 부분
      loggedIn: false, // 네이버 로그인 상태가 저장되어 있는지
    },
    instagram: {
      loggedIn: false, // 인스타그램 로그인 상태가 저장되어 있는지
      username: '', // 연결된 인스타그램 계정 이름
    },
    youtubeProfile: {
      channelTheme: '', // 내 채널 주제 (예: 40대 재테크)
      targetAudience: '', // 주 시청자층 (예: 사회 초년생)
      creatorPerspective: '', // 화자의 관점/캐릭터 (예: 10년차 실무자)
    },
    publishDefaults: {
      category: '', // 블로그 발행 시 기본 카테고리
      visibility: 'public', // 공개 범위 (public: 전체공개 / private: 비공개)
      autoIntervalMinutes: 60, // 여러 글을 자동 발행할 때 글 사이의 대기 시간(분)
      maxImages: 3, // 글 한 편에 넣을 이미지 최대 장수
      insertDisclaimer: true, // 글 끝에 안내 문구(정보성 참고용 등)를 넣을지 여부
    },
    // 생성된 글·이미지·영상이 저장될 기본 폴더 (내 문서 > 마케팅자동화)
    outputFolder: path.join(app.getPath('documents'), '마케팅자동화'),
  };
}

function isPlainObject(value) {
  // 배열·문자열 등이 아닌, 일반적인 "키: 값" 형태의 객체만 병합 대상으로 인정한다.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base, patch) {
  // 설정 일부만 저장해도 나머지 기본 설정이 사라지지 않도록 깊이 합친다.
  // 예) 화면에서 "이미지 장수"만 바꿔 저장해도 API 키·폴더 설정은 그대로 유지된다.
  // __proto__ 같은 특수 키는 객체 구조를 오염시킬 수 있어 무시한다(보안 조치).
  if (!isPlainObject(patch)) {
    return patch === undefined ? base : patch;
  }
  const result = { ...base };
  for (const key of Object.keys(patch)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      continue;
    }
    result[key] = isPlainObject(base?.[key]) ? deepMerge(base[key], patch[key]) : patch[key];
  }
  return result;
}

/**
 * 저장된 설정을 읽어온다. (암호 해제 → 기본값과 합치기 → 값 검사 순서)
 * 파일이 없거나 깨졌더라도 오류로 멈추지 않고 기본 설정으로 되돌아가 프로그램은 계속 동작한다.
 */
function loadSettings() {
  // 암호화된 설정을 읽은 뒤, 현재 버전에 맞는 안전한 값으로 한 번 더 정리한다.
  const defaults = getDefaultSettings();
  const filePath = settingsFilePath();
  if (!fs.existsSync(filePath)) {
    return defaults;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('시스템 자격 증명 저장소를 사용할 수 없습니다.');
    }
    const encrypted = fs.readFileSync(filePath);
    const decrypted = safeStorage.decryptString(encrypted);
    const saved = JSON.parse(decrypted);
    return normalizeSettings(deepMerge(defaults, saved), defaults);
  } catch (err) {
    console.error('[store] 설정 로드 실패:', err.message);
    return defaults;
  }
}

/**
 * 설정을 저장한다. 바뀐 항목(patch)만 넘겨주면 나머지는 기존 값이 그대로 유지된다.
 * 암호화를 쓸 수 없는 환경이면 저장하지 않고 오류를 내, API 키가 평문으로 남는 일을 막는다.
 */
function saveSettings(patch) {
  // 화면에서 바뀐 일부 값만 받아 기존 값과 합친 뒤 암호화해 저장한다.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('시스템 자격 증명 저장소를 사용할 수 없어 설정을 안전하게 저장할 수 없습니다.');
  }
  const current = loadSettings();
  const merged = normalizeSettings(deepMerge(current, patch), getDefaultSettings());
  const filePath = settingsFilePath();
  const encrypted = safeStorage.encryptString(JSON.stringify(merged));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encrypted);
  return merged;
}

function maskKey(key) {
  // 화면에는 API 키 전체가 보이지 않게 앞뒤 일부만 남긴다. (예: sk-****abcd)
  // 화면 녹화·화면 공유 중에 키가 통째로 노출되는 사고를 막기 위한 조치다.
  if (!key) return '';
  if (key.length <= 7) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

/**
 * 화면으로 보낼 설정: API 키는 마스킹된 표시값과 보유 여부만 전달한다.
 * 화면 코드가 실제 비밀 키를 읽지 못하게 해, 실수로 표시·로그에 남는 위험을 줄인다.
 */
function getSettingsForRenderer() {
  const settings = loadSettings();
  const masked = JSON.parse(JSON.stringify(settings));
  for (const kind of ['text', 'image']) {
    const apiKeys = masked[kind].apiKeys;
    for (const providerId of Object.keys(apiKeys)) {
      const raw = apiKeys[providerId];
      apiKeys[providerId] = { hasKey: Boolean(raw), masked: maskKey(raw) };
    }
  }
  return masked;
}

module.exports = {
  loadSettings,
  saveSettings,
  getSettingsForRenderer,
};
