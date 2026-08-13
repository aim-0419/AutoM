/**
 * [공통 명령 처리실 - 설정 / 블로그 글 생성 / 발행 / 기록]
 *
 * 비개발자를 위한 설명:
 * - AutoM(블로그 전용)과 AutoM Creator 두 앱이 '똑같이' 쓰는 기능들을 모아둔 곳입니다.
 * - 화면에서 버튼을 누르면 → preload(창구) → 이 파일(처리실) → 실제 기능 모듈 순으로 일이 넘어갑니다.
 * - 이 파일에서 중요한 것은 '실행 전 안전 검사'입니다. AI 호출은 돈이 들고 발행은 되돌리기 어렵기
 *   때문에, 시작하기 전에 아래 항목들을 먼저 확인합니다.
 *     · 키워드 개수와 형식이 올바른가
 *     · 이미 발행한 키워드를 또 쓰려는 건 아닌가
 *     · AI API 키가 등록되어 있는가
 *     · 업로드하려는 이미지가 정말 우리 프로그램이 만든 파일인가
 *
 * 4가지 발행 모드 (화면에서 사용자가 선택):
 *   · semi-auto (반자동)    : 글·이미지를 만들어 내 컴퓨터 폴더에만 저장. 발행은 사람이 직접.
 *   · review   (확인 후 발행): 만든 결과를 미리보기로 확인하고, 사용자가 발행 버튼을 눌러야 올라감.
 *   · full-auto(완전자동)   : 만들자마자 바로 발행. 여러 개면 정해진 간격을 두고 순서대로 발행.
 *   · scheduled(예약발행)   : 네이버에 미래 시각으로 예약 등록.
 */
const { ipcMain, dialog, app, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const store = require('./store');
const history = require('./history');
const logger = require('./logger');
const textProviders = require('../core/providers/text');
const imageProviders = require('../core/providers/image');
const { resolveConfiguredProvider } = require('../core/providers/configuredProvider');
const { getApiKeyPageUrl } = require('../core/providers/apiKeyPages');
const pipeline = require('../core/pipeline');
const contentQuality = require('../core/contentQuality');
const schedule = require('../core/schedule');
const { isValidNaverBlogId } = require('../core/settingsValidation');
const naverSession = require('../features/blog/session');
const naverPublisher = require('../features/blog/publisher');

// 완전자동은 계정 보호와 중복 발행 위험을 줄이기 위해 한 번에 3개까지만 허용한다.
// (짧은 시간에 여러 글이 올라가면 네이버가 스팸으로 볼 수 있기 때문)
const MAX_FULL_AUTO_BATCH = 3;
// 발행하지 않는 생성 모드도 실수로 과도한 작업(=과도한 API 비용)을 시작하지 않도록 상한을 둔다.
const MAX_GENERAL_BATCH = 20;
// 동시에 두 작업이 시작되는 것을 막기 위해, 현재 실행 중인 묶음 하나만 기억한다.
// (값이 들어 있으면 "지금 작업 중"이라는 뜻)
let activeBatch = null;

function normalizeKeyword(value) {
  // 띄어쓰기·대소문자·전각 문자만 다른 같은 키워드를 중복으로 잡기 위한 비교용 형태다.
  // 예) "부동산 세금", "부동산  세금", "부동산세금" → 사람이 보기엔 같은 주제이므로 통일해서 비교한다.
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ').trim();
}

/**
 * 생성을 시작하기 전에 요청이 올바른지 검사한다. 하나라도 어긋나면 시작하지 않고 오류를 낸다.
 *
 * 검사 순서:
 *  1) 발행 모드가 정해진 4가지 중 하나인가
 *  2) 키워드가 1개 이상인가 / 20개를 넘지 않는가
 *  3) 자동·예약 발행이면 3개를 넘지 않는가
 *  4) 각 키워드가 1~100자인가
 *  5) 입력 목록 안에 같은 키워드가 두 번 들어있지 않은가
 *  6) 자동·예약 발행이면, 예전에 이미 공개 발행한 키워드를 다시 쓰는 건 아닌가
 */
function validateBatchRequest(keywords, mode, historyEntries) {
  // API 비용이나 실제 발행이 시작되기 전에 모드·개수·중복 키워드를 먼저 확인한다.
  if (!['semi-auto', 'review', 'full-auto', 'scheduled'].includes(mode)) {
    throw new Error('올바른 발행 모드를 선택해주세요.');
  }
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('키워드를 한 개 이상 입력해주세요.');
  }
  if (keywords.length > MAX_GENERAL_BATCH) {
    throw new Error(`한 번에 생성할 수 있는 키워드는 최대 ${MAX_GENERAL_BATCH}개입니다.`);
  }
  const isAutomatedPublishing = mode === 'full-auto' || mode === 'scheduled';
  if (isAutomatedPublishing && keywords.length > MAX_FULL_AUTO_BATCH) {
    throw new Error(`자동·예약 발행은 대량 등록 위험을 줄이기 위해 한 번에 최대 ${MAX_FULL_AUTO_BATCH}개까지만 실행할 수 있습니다.`);
  }

  const normalized = keywords.map(normalizeKeyword);
  if (normalized.some((keyword) => !keyword || keyword.length > 100)) {
    throw new Error('각 키워드는 1~100자로 입력해주세요.');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('입력 목록에 같은 키워드가 두 번 이상 있습니다. 중복 항목을 제거해주세요.');
  }

  if (isAutomatedPublishing) {
    // 완전자동은 사용자가 글을 하나씩 검토하지 않으므로, 이미 공개한 주제의 반복도 막는다.
    const publishedKeywords = new Set(
      (Array.isArray(historyEntries) ? historyEntries : [])
        .filter(
          (entry) =>
            entry?.status === 'success' &&
            entry?.visibility !== 'private' &&
            contentQuality.isNaverBlogUrl(entry.url)
        )
        .map((entry) => normalizeKeyword(entry.keyword))
        .filter(Boolean)
    );
    const repeated = normalized.filter((keyword) => publishedKeywords.has(keyword));
    if (repeated.length > 0) {
      throw new Error('자동·예약 발행에서는 이미 등록한 키워드를 다시 사용할 수 없습니다. 새 검색 의도의 키워드를 입력해주세요.');
    }
  }
}

function isPathInside(parentPath, candidatePath) {
  // 사용자 입력으로 다른 폴더의 파일을 읽거나 올리지 못하게, 허용된 폴더 안인지 확인한다.
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function validateGeneratedImagePaths(images, settings) {
  // 네이버 업로드는 이 프로그램이 생성한 PNG 파일에만 허용한다.
  // 임의의 컴퓨터 파일을 실수로 올리거나 경로를 조작하는 문제를 막는다.
  const allowedRoots = [settings.outputFolder, path.join(app.getPath('temp'), 'marketing-app')];
  for (const image of Array.isArray(images) ? images : []) {
    const imagePath = image?.path;
    const isAllowed =
      typeof imagePath === 'string' &&
      path.extname(imagePath).toLocaleLowerCase() === '.png' &&
      fs.existsSync(imagePath) &&
      allowedRoots.some((root) => isPathInside(root, imagePath));
    if (!isAllowed) {
      throw new Error('앱이 생성한 PNG 이미지만 네이버에 업로드할 수 있습니다.');
    }
  }
}

/**
 * 완성된 글이 발행해도 되는 수준인지 '품질 검사'를 돌린다.
 * - 글자 수, 문단 구성, 금지 표현, 과거 글과의 내용 중복 등을 확인한다.
 * - 검사에 쓰는 내부 데이터(비교용 지문)는 화면으로 보내지 않고 기록에만 저장한다.
 *   화면에는 사람이 이해할 수 있는 요약 결과만 전달한다.
 */
function auditGeneratedContent(content, historyEntries, strictTopicDuplicates = false) {
  // 내부 검사 결과와 화면에 보여 줄 결과를 함께 만든다.
  // 비교용 지문은 화면에 보내지 않고, 발행 기록에만 따로 저장한다.
  const report = contentQuality.auditContent(content, { historyEntries, strictTopicDuplicates });
  return {
    report,
    content: { ...content, qualityReport: contentQuality.toPublicQualityReport(report) },
  };
}

function withFileUrls(content) {
  // 화면의 미리보기 영역은 브라우저처럼 동작하므로, PC의 이미지 경로를 file:// 주소로 바꿔서 보여준다.
  return {
    ...content,
    images: content.images.map((img) => ({ ...img, fileUrl: pathToFileURL(img.path).href })),
  };
}

function validateProviderKeys(settings) {
  // 글 AI와 이미지 AI 키가 없으면 생성 자체를 시작하지 않는다.
  // 중간에 멈추는 것보다, 사용자에게 "설정에서 키를 입력하라"고 바로 알려주는 편이 안전하다.
  resolveConfiguredProvider(settings, 'text', textProviders);
  resolveConfiguredProvider(settings, 'image', imageProviders);
}

/**
 * 자동·예약 발행을 시작하기 전에 네이버 쪽 준비 상태를 미리 확인한다.
 *
 * 왜 필요한가요?
 * 글과 이미지를 만드는 데는 실제 AI 요금이 듭니다. 다 만든 뒤 발행 단계에서
 * "블로그 ID가 없다" 또는 "로그인이 안 되어 있다"를 알게 되면 그 비용이 전부 낭비됩니다.
 * 그래서 돈이 들기 전에 여기서 먼저 막습니다.
 *
 * 로그인 확인은 네이버에 접속하지 않고 저장된 쿠키만 봅니다.
 * 빠르고, 인터넷이 잠시 느려도 오판하지 않습니다.
 * 다만 확인 자체가 불가능한 경우(unknown)에는 사용자의 작업을 막지 않고 진행시킵니다.
 * 잘못 막는 것이 그냥 진행하는 것보다 더 나쁘기 때문입니다.
 */
async function assertReadyForAutomatedPublishing(settings) {
  if (!settings.naver.blogId) {
    throw new Error(
      '설정에서 네이버 블로그 ID를 먼저 입력해주세요. 발행 주소를 만들 때 필요합니다.'
    );
  }

  const login = await naverSession.hasDurableLogin();
  if (login.unknown) {
    logger.error(`네이버 로그인 사전 확인 불가: ${login.message}`);
    return;
  }
  if (!login.durable) {
    throw new Error(
      login.sessionOnly
        ? '네이버 로그인이 유지되지 않는 상태입니다. 설정에서 다시 로그인할 때 "로그인 상태 유지"를 켠 채로 진행해주세요.'
        : '설정에서 네이버 로그인을 먼저 해주세요. 자동·예약 발행은 로그인이 유지된 상태에서만 실행할 수 있습니다.'
    );
  }
}

function loadSettingsWithProviderRepair() {
  // 선택 공급자에는 키가 없고 저장된 키가 하나뿐이면 그 공급자로 설정을 바로잡는다.
  // 예: OpenAI 키만 저장했는데 기본 선택이 Anthropic으로 남은 경우를 자동 복구한다.
  let settings = store.loadSettings();
  const providerPatch = {};

  for (const [kind, registry] of [
    ['text', textProviders],
    ['image', imageProviders],
  ]) {
    try {
      const resolved = resolveConfiguredProvider(settings, kind, registry);
      if (resolved.autoSelected) {
        providerPatch[kind] = { provider: resolved.providerId };
      }
    } catch {
      // 저장된 키가 없거나 여러 공급자가 애매하면 설정 화면에서 사용자가 직접 선택하게 둔다.
    }
  }

  if (Object.keys(providerPatch).length > 0) {
    settings = store.saveSettings(providerPatch);
  }
  return settings;
}

async function publishToNaver(content, { scheduleAt = null } = {}) {
  // 네이버 블로그 ID는 발행 주소를 만들 때 꼭 필요하다.
  // 예: blog.naver.com/내블로그ID 의 "내블로그ID" 부분.
  const settings = store.loadSettings();
  if (!settings.naver.blogId) {
    return { success: false, message: '설정에서 네이버 블로그 ID를 입력해주세요.' };
  }
  return naverPublisher.publish(content, { blogId: settings.naver.blogId, settings, scheduleAt });
}

/**
 * 완전자동 모드에서 다음 키워드 발행 전 대기한다 (계정 보호를 위한 발행 간격, 최소 30분).
 * 5초 간격으로 남은 시간을 진행 상태로 알린다.
 *
 * 비개발자용 설명:
 * 키워드를 여러 개 넣고 완전자동을 실행하면 글을 연속으로 올리게 된다.
 * 너무 짧은 시간에 여러 글을 올리면 자동화/스팸처럼 보일 수 있으므로,
 * 한 글을 발행한 뒤 다음 글까지 일부러 기다린다.
 * 설정 화면의 "완전자동 발행 간격" 값이 여기서 사용되며, 최소 30분보다 짧게는 동작하지 않는다.
 */
async function waitForNextAutoPublish({ minutes, nextKeyword, nextIndex, total, sendProgress, isCancelled }) {
  const intervalMs = Math.max(30, minutes || 60) * 60 * 1000;
  const waitUntil = Date.now() + intervalMs;

  while (Date.now() < waitUntil) {
    if (isCancelled()) {
      sendProgress({ index: nextIndex, total, keyword: nextKeyword, stage: 'cancelled' });
      return false;
    }
    const remainingSeconds = Math.ceil((waitUntil - Date.now()) / 1000);
    sendProgress({
      index: nextIndex,
      total,
      keyword: nextKeyword,
      stage: 'waiting',
      remainingSeconds,
    });
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, waitUntil - Date.now())));
  }
  return true;
}

function registerIpcHandlers(getMainWindow) {
  // 여기 아래의 ipcMain.handle은 화면에서 호출할 수 있는 "명령 목록"이다.
  // 각 명령은 설정·발행·기록처럼 담당 기능으로만 넘겨 책임을 나눈다.
  ipcMain.handle('settings:get', () => {
    loadSettingsWithProviderRepair();
    return {
      settings: store.getSettingsForRenderer(),
      textProviders: textProviders.list(),
      imageProviders: imageProviders.list(),
    };
  });

  ipcMain.handle('settings:save', (_event, patch) => {
    // 저장 전에 블로그 ID 형식을 확인해, 잘못된 주소로 발행되는 일을 막는다.
    const blogId = patch?.naver?.blogId;
    if (blogId !== undefined && !isValidNaverBlogId(blogId)) {
      throw new Error('네이버 블로그 ID는 영문, 숫자, 밑줄, 하이픈을 사용한 5~20자로 입력해주세요.');
    }
    store.saveSettings(patch);
    loadSettingsWithProviderRepair();
    return { settings: store.getSettingsForRenderer() };
  });

  ipcMain.handle('settings:test-connection', async (_event, { kind, provider, apiKey, model }) => {
    // 새 키를 입력했다면 그 키를, 비워 두었다면 이미 안전하게 저장된 키를 시험한다.
    try {
      const registry = kind === 'image' ? imageProviders : textProviders;
      const providerModule = registry.get(provider);

      let keyToUse = apiKey;
      if (!keyToUse) {
        const saved = store.loadSettings();
        keyToUse = saved[kind]?.apiKeys?.[provider];
      }

      return await providerModule.testConnection({ apiKey: keyToUse, model });
    } catch (err) {
      return { success: false, message: err.message || '알 수 없는 오류가 발생했습니다.' };
    }
  });

  ipcMain.handle('settings:open-api-key-page', (_event, providerId) => {
    // 화면이 URL을 직접 지정하지 못하게 하고, 프로그램에 등록된 공식 키 관리 페이지만 연다.
    return shell.openExternal(getApiKeyPageUrl(providerId));
  });

  ipcMain.handle('settings:choose-output-folder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('naver:login', async () => {
    // 로그인 창은 별도 Chromium 창으로 열고, 성공 여부만 화면에 돌려준다.
    //
    // 중요: '로그인 화면을 벗어났다'는 것만으로 성공 처리하지 않는다.
    // 브라우저를 껐다 켜도 유지되는 로그인(durable)일 때만 연결됨으로 저장한다.
    // 그러지 않으면 설정 화면에는 "연결됨"으로 보이는데 발행 단계에서 로그인이 풀려,
    // 사용자가 원인을 알 수 없는 실패를 겪게 된다.
    try {
      const result = await naverSession.login();
      store.saveSettings({ naver: { loggedIn: result.durable === true } });

      if (result.durable) {
        return { success: true, message: result.message };
      }

      if (result.loggedIn) {
        // 로그인은 됐지만 유지되지 않는 상태다. 그대로 두면 발행할 때 실패하므로 실패로 안내한다.
        logger.error(`네이버 로그인 유지 실패: keepChecked=${result.keepChecked} / ${result.message}`);
      }
      return { success: false, message: result.message };
    } catch (err) {
      logger.error(`네이버 로그인 실패: ${err.message}`);
      return { success: false, message: err.message || '네이버 로그인 중 오류가 발생했습니다.' };
    }
  });

  ipcMain.handle('naver:reset-session', async () => {
    try {
      naverSession.resetSession();
      store.saveSettings({ naver: { loggedIn: false } });
      return { success: true, message: '네이버 세션이 초기화되었습니다.' };
    } catch (err) {
      return { success: false, message: err.message || '세션 초기화 중 오류가 발생했습니다.' };
    }
  });

  ipcMain.handle('naver:publish', async (_event, { keyword, title, body, tags, images, scheduleAt }) => {
    // "확인 후 발행" 모드에서 미리보기 내용을 사용자가 확인한 뒤 누르는 발행 버튼의 실제 처리다.
    // 성공/실패 여부는 발행 기록에 남겨 나중에 다시 확인할 수 있게 한다.
    let result;
    let normalizedScheduleAt = null;
    const content = { keyword: keyword || '', title, body, tags, images: images || [] };
    // 미리보기에서 사용자가 내용을 고쳤을 수 있으므로, 발행 직전에 다시 품질 검사를 한다.
    const qualityReport = contentQuality.auditContent(content, { historyEntries: history.listHistory() });
    try {
      if (!qualityReport.passed) {
        result = { success: false, message: contentQuality.formatBlockingQualityMessage(qualityReport) };
      } else {
        validateGeneratedImagePaths(content.images, store.loadSettings());
        normalizedScheduleAt = scheduleAt ? schedule.normalizeScheduleAt(scheduleAt) : null;
        result = await publishToNaver(content, { scheduleAt: normalizedScheduleAt });
      }
    } catch (err) {
      logger.error(`네이버 발행 중 오류: ${err.message}`);
      result = { success: false, message: err.message || '네이버 발행 중 오류가 발생했습니다.' };
    }

    history.addHistoryEntry({
      keyword: keyword || '',
      title,
      mode: normalizedScheduleAt ? 'scheduled' : 'review',
      status: result.success ? 'success' : 'failure',
      url: result.url || null,
      message: result.message,
      scheduledAt: result.scheduledAt || normalizedScheduleAt,
      visibility: store.loadSettings().publishDefaults.visibility,
      ...(result.success ? contentQuality.buildHistoryQualityFields(qualityReport) : {}),
    });

    return result;
  });

  ipcMain.handle('history:list', () => {
    return history.listHistory();
  });

  ipcMain.handle('history:open-url', (_event, url) => {
    const isInstagramPostUrl = /^https:\/\/(?:www\.)?instagram\.com\/p\/[a-z0-9_-]+\/?(?:\?.*)?$/i.test(
      String(url || '')
    );
    if (!contentQuality.isNaverBlogUrl(url) && !isInstagramPostUrl) {
      throw new Error('안전한 네이버 또는 인스타그램 게시물 주소만 열 수 있습니다.');
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('history:get-used-keywords', () => {
    return history.getUsedKeywords();
  });

  ipcMain.handle('history:get-published-keywords', () => {
    return history.getPublishedKeywords();
  });

  ipcMain.handle('keyword:recommend', async () => {
    // 과거에 쓴 키워드를 AI에 알려 주고, 추천 결과에서도 한 번 더 제외한다.
    try {
      const settings = loadSettingsWithProviderRepair();
      const textConfig = resolveConfiguredProvider(settings, 'text', textProviders);
      const textProviderId = textConfig.providerId;
      const apiKey = textConfig.apiKey;

      const excludeKeywords = history.getUsedKeywords();
      const provider = textProviders.get(textProviderId);
      const suggestions = await provider.generateKeywordSuggestions({
        count: 5,
        excludeKeywords,
        model: textConfig.model,
        apiKey,
      });

      const usedSet = new Set(excludeKeywords);
      const candidates = suggestions.filter((k) => !usedSet.has(k));
      const picked = candidates[Math.floor(Math.random() * candidates.length)] || suggestions[0];

      if (!picked) {
        return { success: false, message: '추천할 키워드를 생성하지 못했습니다.' };
      }

      return { success: true, keyword: picked };
    } catch (err) {
      logger.error(`키워드 추천 실패: ${err.message}`);
      return { success: false, message: err.message || '키워드 추천 중 오류가 발생했습니다.' };
    }
  });

  ipcMain.handle('pipeline:cancel', () => {
    // 진행 중인 API 요청을 강제로 끊기보다, 현재 단계가 끝나는 안전한 지점에서 멈추도록 표시한다.
    if (!activeBatch) {
      return { success: false, message: '진행 중인 작업이 없습니다.' };
    }
    activeBatch.cancelled = true;
    return { success: true, message: '현재 단계가 끝나는 대로 작업을 중단합니다.' };
  });

  /**
   * [핵심] 메인 화면의 '생성 시작' 버튼이 실행하는 기능이다.
   *
   * 전체 흐름 (키워드 하나당 반복):
   *   1) 요청 검사 → 2) AI로 글 작성 → 3) 글에 맞는 이미지 생성 →
   *   4) 내 예전 글로 가는 내부 링크 붙이기 → 5) 품질 검사 →
   *   6) 모드에 따라 발행 / 예약 / 미리보기 대기 → 7) 기록 남기기
   *
   * 완전자동에서 여러 개를 처리할 때는 글과 글 사이에 설정된 시간만큼 기다린다.
   * 중간에 발행이 실패하면 남은 작업은 자동으로 중단해, 문제가 반복되는 것을 막는다.
   */
  ipcMain.handle('pipeline:generate-batch', async (_event, { keywords, mode, scheduleAt }) => {
    // 메인 화면의 [생성 시작] 버튼이 누르면 여기로 들어온다.
    // keywords는 사용자 키워드 목록이고, mode는 반자동/확인 후 발행/완전자동/예약발행 중 하나다.
    const settings = loadSettingsWithProviderRepair();
    const historyEntries = history.listHistory();
    validateBatchRequest(keywords, mode, historyEntries);
    const normalizedScheduleStart = mode === 'scheduled' ? schedule.normalizeScheduleAt(scheduleAt) : null;
    validateProviderKeys(settings);
    // 자동·예약 발행은 사람이 중간에 확인하지 않으므로, 돈이 드는 생성을 시작하기 전에
    // 네이버 준비 상태(블로그 ID, 유지되는 로그인)를 먼저 확인한다.
    if (mode === 'full-auto' || mode === 'scheduled') {
      await assertReadyForAutomatedPublishing(settings);
    }
    if (activeBatch) {
      throw new Error('이미 생성 또는 발행 작업이 진행 중입니다.');
    }

    const batchState = { cancelled: false };
    activeBatch = batchState;

    try {
      const sendProgress = (data) => {
        getMainWindow()?.webContents.send('pipeline:progress', data);
      };

      const results = [];
      // 중단·실패가 생겼을 때 아직 처리하지 않은 키워드들을 한꺼번에 '취소' 상태로 정리한다.
      // (화면의 진행 목록에 빈칸이 남지 않도록 각 항목에 사유를 채워준다)
      const stopRemaining = (startIndex, stage, message) => {
        for (let index = startIndex; index < keywords.length; index += 1) {
          sendProgress({ index, total: keywords.length, keyword: keywords[index], stage });
          results.push({ keyword: keywords[index], status: 'error', message });
        }
      };

      for (let i = 0; i < keywords.length; i += 1) {
        const keyword = keywords[i];

        if (batchState.cancelled) {
          stopRemaining(i, 'cancelled', '사용자가 작업을 중단했습니다.');
          break;
        }

        try {
        const isSemiAuto = mode === 'semi-auto';
        // 반자동은 결과물을 사용자가 직접 열어볼 수 있도록 output 폴더에 저장한다.
        // 확인 후 발행/완전자동/예약발행은 임시 폴더에서 만든 뒤 미리보기 또는 네이버 등록에 사용한다.
        const workDir = isSemiAuto
          ? path.join(settings.outputFolder, pipeline.buildJobFolderName(keyword))
          : path.join(app.getPath('temp'), 'marketing-app', `${Date.now()}-${i}`);

        // 실제 AI 호출이 일어나는 단계다.
        // 글을 먼저 만들고, 글 안의 [IMAGE_1] 같은 표시 위치에 맞춰 이미지를 만든다.
        let content = await pipeline.generateContent({
          keyword,
          settings,
          workDir,
          onProgress: (stage) => sendProgress({ index: i, total: keywords.length, keyword, stage }),
          isCancelled: () => batchState.cancelled,
        });
        if (batchState.cancelled) {
          stopRemaining(i, 'cancelled', '사용자가 작업을 중단했습니다.');
          break;
        }
        // 이전 발행 성공 글 중 현재 글과 관련 있는 글이 있으면 본문 하단에 내부링크를 붙인다.
        const currentHistory = history.listHistory();
        content = pipeline.appendInternalLinks(content, currentHistory);
        const audited = auditGeneratedContent(
          content,
          currentHistory,
          mode === 'full-auto' || mode === 'scheduled'
        );
        content = audited.content;
        if (!audited.report.passed) {
          throw new Error(contentQuality.formatBlockingQualityMessage(audited.report));
        }

        if (mode === 'full-auto' || mode === 'scheduled') {
          // 완전자동은 즉시 발행하고, 예약발행은 네이버 서버에 미래 시각을 등록한다.
          const itemScheduleAt = normalizedScheduleStart
            ? schedule.buildBatchScheduleAt(
                normalizedScheduleStart,
                i,
                settings.publishDefaults.autoIntervalMinutes
              )
            : null;
          sendProgress({
            index: i,
            total: keywords.length,
            keyword,
            stage: itemScheduleAt ? 'scheduling' : 'publishing',
          });
          const publishResult = await publishToNaver(content, { scheduleAt: itemScheduleAt });
          results.push({
            keyword,
            status: 'generated',
            content: withFileUrls(content),
            publish: publishResult,
          });

          history.addHistoryEntry({
            keyword,
            title: content.title,
            mode,
            status: publishResult.success ? 'success' : 'failure',
            url: publishResult.url || null,
            message: publishResult.message,
            scheduledAt: publishResult.scheduledAt || itemScheduleAt,
            visibility: settings.publishDefaults.visibility,
            ...(publishResult.success ? contentQuality.buildHistoryQualityFields(audited.report) : {}),
          });

          if (!publishResult.success) {
            sendProgress({ index: i, total: keywords.length, keyword, stage: 'error' });
            stopRemaining(i + 1, 'cancelled', '이전 글 등록이 실패하여 남은 자동·예약 발행을 중단했습니다.');
            break;
          }
          sendProgress({
            index: i,
            total: keywords.length,
            keyword,
            stage: itemScheduleAt ? 'scheduled' : 'published',
          });

          // 계정 보호를 위해 다음 키워드 발행 전 설정된 간격만큼 대기한다 (최소 30분).
          if (mode === 'full-auto' && i < keywords.length - 1) {
            const shouldContinue = await waitForNextAutoPublish({
              minutes: settings.publishDefaults.autoIntervalMinutes,
              nextKeyword: keywords[i + 1],
              nextIndex: i + 1,
              total: keywords.length,
              sendProgress,
              isCancelled: () => batchState.cancelled,
            });
            if (!shouldContinue) {
              stopRemaining(i + 1, 'cancelled', '사용자가 작업을 중단했습니다.');
              break;
            }
          }
        } else {
          // 반자동/확인 후 발행은 여기서 멈춘다.
          // 이후 사용자가 미리보기에서 저장 또는 발행 버튼을 직접 누른다.
          results.push({ keyword, status: 'generated', content: withFileUrls(content) });
        }
        } catch (err) {
          if (err.code !== 'BATCH_CANCELLED') {
            logger.error(`콘텐츠 생성 실패 [${keyword}]: ${err.message}`);
          }
          sendProgress({
            index: i,
            total: keywords.length,
            keyword,
            stage: err.code === 'BATCH_CANCELLED' ? 'cancelled' : 'error',
          });
          results.push({ keyword, status: 'error', message: err.message || '생성 중 오류가 발생했습니다.' });
        }
      }

      return { results, cancelled: batchState.cancelled };
    } finally {
      // 성공했든 오류가 났든 '작업 중' 표시를 반드시 해제한다.
      // 그래야 다음 번에 생성 시작 버튼을 다시 누를 수 있다.
      if (activeBatch === batchState) {
        activeBatch = null;
      }
    }
  });

  ipcMain.handle('pipeline:save-to-folder', async (_event, { keyword, workDir, title, body, tags }) => {
    // 반자동 결과도 저장 직전에 품질·경로 검사를 해, 화면에서 수정된 내용이 기준을 벗어나지 않게 한다.
    try {
      const settings = store.loadSettings();
      if (!isPathInside(settings.outputFolder, workDir)) {
        throw new Error('설정한 출력 폴더 안의 생성 결과만 저장할 수 있습니다.');
      }
      const images = fs
        .readdirSync(workDir)
        .map((name) => name.match(/^image_(\d+)\.png$/))
        .filter(Boolean)
        .map((match) => ({ index: Number(match[1]) }));

      const content = { keyword: keyword || '', title, body, tags, images };
      const qualityReport = contentQuality.auditContent(content, { historyEntries: history.listHistory() });
      if (!qualityReport.passed) {
        throw new Error(contentQuality.formatBlockingQualityMessage(qualityReport));
      }

      pipeline.writeMarkdownFile({ content, targetDir: workDir });
      await shell.openPath(workDir);

      history.addHistoryEntry({
        keyword: keyword || '',
        title,
        mode: 'semi-auto',
        status: 'success',
        url: null,
        message: `폴더에 저장됨: ${workDir}`,
        ...contentQuality.buildHistoryQualityFields(qualityReport),
      });
    } catch (err) {
      logger.error(`폴더 저장 실패: ${err.message}`);
      throw new Error(`폴더에 저장하지 못했습니다: ${err.message}`);
    }

    return { savedDir: workDir };
  });
}

module.exports = {
  registerIpcHandlers,
  _test: {
    isPathInside,
    validateBatchRequest,
    waitForNextAutoPublish,
  },
};
