const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const textProviders = require('../core/providers/text');
const imageProviders = require('../core/providers/image');
const { normalizeSettings } = require('../core/settingsValidation');

/**
 * 사용자의 설정을 읽고 저장하는 보관함이다.
 * API 키는 일반 JSON이 아니라 운영체제의 암호화 저장소를 이용해 settings.dat에 보관한다.
 */
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
      blogId: '',
      loggedIn: false,
    },
    instagram: {
      loggedIn: false,
      username: '',
    },
    youtubeProfile: {
      channelTheme: '',
      targetAudience: '',
      creatorPerspective: '',
    },
    publishDefaults: {
      category: '',
      visibility: 'public',
      autoIntervalMinutes: 60,
      maxImages: 3,
      insertDisclaimer: true,
    },
    outputFolder: path.join(app.getPath('documents'), '마케팅자동화'),
  };
}

function isPlainObject(value) {
  // 배열·문자열 등이 아닌, 일반적인 "키: 값" 형태의 객체만 병합 대상으로 인정한다.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base, patch) {
  // 설정 일부만 저장해도 나머지 기본 설정이 사라지지 않도록 깊이 합친다.
  // __proto__ 같은 특수 키는 객체 구조를 오염시킬 수 있어 무시한다.
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
  // 화면에는 API 키 전체가 보이지 않게 앞뒤 일부만 남긴다.
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
  getDefaultSettings,
  loadSettings,
  saveSettings,
  getSettingsForRenderer,
  maskKey,
};
