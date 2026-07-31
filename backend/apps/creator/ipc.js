/**
 * Creator 화면에서 요청한 인스타그램·유튜브 작업을 실제 기능 모듈에 전달한다.
 * 공통 설정과 발행 기록은 블로그 앱과 같은 저장 모듈을 사용한다.
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

const CAPCUT_EDITOR_URL = 'https://www.capcut.com/tools/online-video-editor';
const YOUTUBE_UPLOAD_URL = 'https://www.youtube.com/upload';

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

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

function registerCreatorIpcHandlers() {
  ipcMain.handle('instagram:session-status', () => {
    const instagram = store.loadSettings().instagram;
    return { loggedIn: instagram.loggedIn, username: instagram.username };
  });

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

  ipcMain.handle('instagram:reset-session', () => {
    try {
      instagramSession.resetSession();
      store.saveSettings({ instagram: { loggedIn: false, username: '' } });
      return { success: true, message: '인스타그램 로그인 세션을 초기화했습니다.' };
    } catch (error) {
      return { success: false, message: error.message || '인스타그램 세션 초기화에 실패했습니다.' };
    }
  });

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

    if (result.code === 'LOGIN_REQUIRED') {
      store.saveSettings({ instagram: { loggedIn: false } });
      return result;
    }

    if (result.success) {
      store.saveSettings({
        instagram: {
          loggedIn: true,
          username: result.username || settings.instagram.username,
        },
      });
    }

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

  ipcMain.handle('youtube:generate-project', async (event, payload = {}) => {
    let result;
    try {
      const youtubeProfile = {
        channelTheme: payload.channelTheme,
        targetAudience: payload.targetAudience,
        creatorPerspective: payload.creatorPerspective,
      };
      store.saveSettings({ youtubeProfile });
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

  ipcMain.handle('youtube:open-capcut', async () => {
    try {
      await shell.openExternal(CAPCUT_EDITOR_URL);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message || 'CapCut 편집 페이지를 열지 못했습니다.' };
    }
  });

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
  _test: { isPathInside, validateInstagramCardPaths, CAPCUT_EDITOR_URL, YOUTUBE_UPLOAD_URL },
};
