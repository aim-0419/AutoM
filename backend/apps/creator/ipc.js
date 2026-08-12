/**
 * [Creator 전용 명령 처리실 - 인스타그램 / 유튜브]
 *
 * 비개발자를 위한 설명:
 * - preload.js가 '창구'라면, 이 파일은 창구에 접수된 요청을 실제로 처리하는 '작업실'입니다.
 * - 화면에서 "인스타 카드 만들어줘" 버튼을 누르면 → 창구(preload) → 이 파일 → 실제 기능 모듈
 *   (features/instagram, features/youtube) 순서로 일이 넘어가고, 결과가 반대 방향으로 돌아옵니다.
 * - 모든 처리는 try/catch로 감싸서, 오류가 나더라도 프로그램이 꺼지지 않고
 *   "무엇이 잘못됐는지" 한국어 메시지로 화면에 보여줍니다.
 * - 블로그 기능은 여기서 다루지 않습니다. 블로그는 두 앱이 공유하는 shared/ipc.js가 담당합니다.
 */
const { ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../../shared/store');
const history = require('../../shared/history');
const instagramPipeline = require('../../features/instagram/pipeline');
const instagramSession = require('../../features/instagram/session');
const instagramPublisher = require('../../features/instagram/publisher');
const youtubePipeline = require('../../features/youtube/pipeline');
const logger = require('../../shared/logger');

// 사용자가 "영상 편집하러 가기" / "유튜브에 올리기" 버튼을 눌렀을 때 열어줄 웹 주소
const CAPCUT_EDITOR_URL = 'https://www.capcut.com/tools/online-video-editor';
const YOUTUBE_UPLOAD_URL = 'https://www.youtube.com/upload';

/**
 * 어떤 폴더(parentPath) '안쪽'에 있는 파일/폴더인지 확인한다.
 *
 * 왜 필요한가요?
 * - 화면에서 넘어온 파일 경로를 아무 검증 없이 열거나 업로드하면,
 *   실수(또는 악의적인 조작)로 컴퓨터의 엉뚱한 파일이 인스타그램에 올라갈 수 있습니다.
 * - 그래서 "우리 프로그램이 만든 출력 폴더 안의 파일이 맞는지"를 반드시 확인합니다.
 * - `..`(상위 폴더로 빠져나가기)로 시작하면 바깥 경로이므로 거부합니다.
 */
function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * 인스타그램에 올릴 카드 이미지들이 '안전하고 올바른 파일'인지 검사한다.
 *
 * 검사 항목 4가지:
 *  1) 장수가 2~10장인가 (인스타그램 여러 장 게시물의 규격)
 *  2) 확장자가 .png 인가
 *  3) 파일이 실제로 존재하는가
 *  4) 우리 프로그램의 출력 폴더 안에 있는 파일인가
 * 하나라도 어긋나면 발행을 진행하지 않고 즉시 오류 메시지를 냅니다.
 */
function validateInstagramCardPaths(cards, outputFolder) {
  if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) {
    throw new Error('발행할 인스타그램 카드는 2~10장이 필요합니다.');
  }
  return cards.map((card) => {
    const imagePath = card?.path;
    if (
      typeof imagePath !== 'string' ||
      path.extname(imagePath).toLocaleLowerCase() !== '.png' ||
      !fs.existsSync(imagePath) ||
      !isPathInside(outputFolder, imagePath)
    ) {
      throw new Error('Creator가 출력 폴더에 만든 PNG 카드만 발행할 수 있습니다.');
    }
    return path.resolve(imagePath);
  });
}

/**
 * 화면이 부를 수 있는 Creator 전용 명령들을 등록한다.
 * 앱이 켜질 때 딱 한 번 실행되며, 이후 화면의 요청이 여기에 연결된 함수로 들어온다.
 */
function registerCreatorIpcHandlers() {
  // [인스타그램] 현재 로그인 상태 확인 — 화면 상단에 "@계정명 연결됨"을 표시하는 데 사용
  ipcMain.handle('instagram:session-status', () => {
    const instagram = store.loadSettings().instagram;
    return { loggedIn: instagram.loggedIn, username: instagram.username };
  });

  // [인스타그램] 로그인 — 자동화 브라우저 창을 띄워 사용자가 직접 로그인하게 하고,
  // 성공하면 그 로그인 상태를 저장해 다음부터는 다시 로그인하지 않아도 되게 한다.
  ipcMain.handle('instagram:login', async () => {
    try {
      const result = await instagramSession.login();
      store.saveSettings({ instagram: result });
      return result.loggedIn
        ? { success: true, message: result.username ? `@${result.username} 계정에 연결되었습니다.` : '인스타그램에 연결되었습니다.', ...result }
        : { success: false, message: '로그인 창이 닫혔거나 제한 시간 안에 로그인이 완료되지 않았습니다.', ...result };
    } catch (error) {
      return { success: false, message: error.message || '인스타그램 로그인 중 오류가 발생했습니다.' };
    }
  });

  // [인스타그램] 로그아웃(세션 초기화) — 다른 계정으로 바꾸거나 문제가 생겼을 때 사용
  ipcMain.handle('instagram:reset-session', () => {
    try {
      instagramSession.resetSession();
      store.saveSettings({ instagram: { loggedIn: false, username: '' } });
      return { success: true, message: '인스타그램 로그인 세션을 초기화했습니다.' };
    } catch (error) {
      return { success: false, message: error.message || '인스타그램 세션 초기화에 실패했습니다.' };
    }
  });

  // [인스타그램] 카드뉴스 생성 — 키워드와 장수를 받아 AI가 문구를 쓰고 카드 이미지를 만든다.
  // onProgress로 "몇 번째 카드를 만드는 중"인지 화면에 실시간 전달한다.
  ipcMain.handle('instagram:generate-carousel', async (event, payload = {}) => {
    try {
      const content = await instagramPipeline.generateCarousel({
        keyword: payload.keyword,
        cardCount: payload.cardCount,
        settings: store.loadSettings(),
        onProgress: (progress) => event.sender.send('instagram:progress', progress),
      });
      return { success: true, content };
    } catch (error) {
      return { success: false, message: error.message || '인스타그램 카드 생성 중 오류가 발생했습니다.' };
    }
  });

  // [인스타그램] 발행 — 만들어 둔 카드 이미지를 실제 인스타그램 계정에 업로드한다.
  // 순서: 파일 안전성 검사 → 브라우저 자동화로 업로드 → 로그인 상태 갱신 → 발행 기록 남기기
  ipcMain.handle('instagram:publish-carousel', async (event, payload = {}) => {
    const settings = store.loadSettings();
    let result;
    try {
      const images = validateInstagramCardPaths(payload.cards, settings.outputFolder);
      result = await instagramPublisher.publish(
        {
          images,
          caption: payload.caption,
          username: settings.instagram.username,
        },
        { onProgress: (progress) => event.sender.send('instagram:publish-progress', progress) }
      );
    } catch (error) {
      result = { success: false, message: error.message || '인스타그램 발행 중 오류가 발생했습니다.' };
    }

    if (!result.success) {
      logger.error(`인스타그램 발행 실패: ${result.message}`);
    }

    // 인스타그램 쪽에서 로그인이 풀린 경우: 저장된 상태도 '로그아웃'으로 되돌려
    // 화면이 "다시 로그인하세요"를 정확히 안내할 수 있게 한다. (기록은 남기지 않음)
    if (result.code === 'LOGIN_REQUIRED') {
      store.saveSettings({ instagram: { loggedIn: false } });
      return result;
    }

    // 발행에 성공했다면 로그인이 살아 있다는 뜻이므로 계정 정보를 최신으로 저장한다.
    if (result.success) {
      store.saveSettings({
        instagram: {
          loggedIn: true,
          username: result.username || settings.instagram.username,
        },
      });
    }

    // 성공이든 실패든 '기록' 탭에서 확인할 수 있도록 결과를 남긴다.
    history.addHistoryEntry({
      platform: 'instagram',
      keyword: String(payload.keyword || '').trim(),
      title: String(payload.title || '').trim(),
      mode: 'instagram-browser',
      status: result.success ? 'success' : 'failure',
      url: result.url || null,
      message: result.message,
    });
    return result;
  });

  // [유튜브] 영상 프로젝트 생성 — 키워드 하나로 대본·장면·자막·영상 초안까지 한 번에 만든다.
  ipcMain.handle('youtube:generate-project', async (event, payload = {}) => {
    let result;
    try {
      // 채널 성격(주제/시청자/화자 관점)은 매번 다시 입력하지 않도록 설정에 저장해 둔다.
      const youtubeProfile = {
        channelTheme: payload.channelTheme,
        targetAudience: payload.targetAudience,
        creatorPerspective: payload.creatorPerspective,
      };
      store.saveSettings({ youtubeProfile });
      // 최근에 만든 영상 20개를 AI에게 함께 알려준다.
      // → 비슷한 제목·같은 관점의 영상이 반복 생성되는 것을 막기 위한 '중복 방지' 자료다.
      const recentProjects = history
        .listHistory()
        .filter((entry) => entry?.platform === 'youtube' && entry?.status === 'success')
        .slice(0, 20)
        .map((entry) => ({
          keyword: entry.keyword,
          title: entry.title,
          originalAngle: entry.originalAngle,
        }));
      const content = await youtubePipeline.generateYoutubeProject({
        keyword: payload.keyword,
        format: payload.format,
        durationSeconds: payload.durationSeconds,
        sceneCount: payload.sceneCount,
        contentStyle: payload.contentStyle,
        ...youtubeProfile,
        recentProjects,
        settings: store.loadSettings(),
        onProgress: (progress) => event.sender.send('youtube:progress', progress),
      });
      result = { success: true, content };
    } catch (error) {
      result = { success: false, message: error.message || 'YouTube 영상 생성 중 오류가 발생했습니다.' };
    }

    history.addHistoryEntry({
      platform: 'youtube',
      keyword: String(payload.keyword || '').trim(),
      title: result.content?.title || String(payload.keyword || '').trim(),
      mode: payload.format === 'longform' ? 'youtube-longform' : 'youtube-shorts',
      status: result.success ? 'success' : 'failure',
      message: result.success ? '영상 프로젝트 생성 완료' : result.message,
      outputPath: result.content?.workDir || null,
      originalAngle: result.content?.originalAngle || null,
      channelTheme: result.content?.channelProfile?.channelTheme || String(payload.channelTheme || '').trim(),
    });
    return result;
  });

  // [유튜브] 결과 폴더 열기 — 만들어진 영상/자막 파일이 있는 폴더를 윈도우 탐색기로 연다.
  // 우리 출력 폴더 안쪽인지 반드시 확인한 뒤에만 열어, 엉뚱한 폴더가 열리는 일을 막는다.
  ipcMain.handle('youtube:open-output', async (_event, outputPath) => {
    try {
      const settings = store.loadSettings();
      const targetPath = path.resolve(String(outputPath || ''));
      if (!isPathInside(settings.outputFolder, targetPath) || !fs.statSync(targetPath).isDirectory()) {
        throw new Error('Creator가 만든 YouTube 출력 폴더만 열 수 있습니다.');
      }
      const errorMessage = await shell.openPath(targetPath);
      if (errorMessage) throw new Error(errorMessage);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message || '출력 폴더를 열지 못했습니다.' };
    }
  });

  // [유튜브] 무료 온라인 영상 편집기(CapCut)를 기본 브라우저로 열어준다.
  ipcMain.handle('youtube:open-capcut', async () => {
    try {
      await shell.openExternal(CAPCUT_EDITOR_URL);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message || 'CapCut 편집 페이지를 열지 못했습니다.' };
    }
  });

  // [유튜브] 업로드 페이지를 열어준다. (업로드 자체는 사용자가 직접 진행 — 자동 업로드 아님)
  ipcMain.handle('youtube:open-upload-page', async () => {
    try {
      await shell.openExternal(YOUTUBE_UPLOAD_URL);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message || 'YouTube 업로드 페이지를 열지 못했습니다.' };
    }
  });
}

module.exports = {
  registerCreatorIpcHandlers,
  // `_test`는 자동 테스트에서만 쓰는 통로다. 밑줄로 시작하는 이름은
  // "제품 기능이 아니라 검증용"이라는 관례적 표시다.
  _test: { isPathInside, validateInstagramCardPaths, CAPCUT_EDITOR_URL, YOUTUBE_UPLOAD_URL },
};
