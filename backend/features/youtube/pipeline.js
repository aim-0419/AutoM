/**
 * YouTube용 대본, 장면 이미지, 자막과 무음 WebM 초안을 생성한다.
 * 자동 업로드는 하지 않으며 사용자가 편집·녹음할 수 있는 로컬 파일을 만든다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline: pipeStreams } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const textProviders = require('../../core/providers/text');
const imageProviders = require('../../core/providers/image');
const { resolveConfiguredProvider } = require('../../core/providers/configuredProvider');
const { mapWithConcurrency } = require('../../core/concurrency');
const youtubeSchema = require('../../core/providers/text/youtubeSchema');

const IMAGE_GENERATION_CONCURRENCY = 2;
const VIDEO_FPS = 24;
const AI_VISUAL_DISCLOSURE = '※ 일부 시각 자료는 AI로 제작되었습니다.';

function validateKeyword(keyword) {
  const value = String(keyword || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!value || [...value].length > 120) {
    throw new Error('주제는 1~120자로 입력해 주세요.');
  }
  return value;
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]+/g, '');
}

function findExactDuplicate(value, recentProjects, field) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return null;
  return recentProjects.find((item) => normalizeComparableText(item?.[field]) === normalized) || null;
}

function assertUniqueTopic(keyword, recentProjects) {
  const duplicate = findExactDuplicate(keyword, recentProjects, 'keyword');
  if (duplicate) {
    throw new Error(
      `최근에 같은 주제로 YouTube 프로젝트를 만들었습니다: "${duplicate.title || duplicate.keyword}". 새 주제나 분명히 다른 관점으로 입력해 주세요.`
    );
  }
}

function calculateMetadataAlignment(project) {
  const stopWords = new Set(['위해', '먼저', '하는', '방법', '영상', '확인', '정리']);
  const titleTerms = (String(project.title || '').match(/[0-9a-z가-힣]{2,}/gi) || [])
    .map((term) => term.toLocaleLowerCase('ko-KR'))
    .filter((term) => !stopWords.has(term));
  if (!titleTerms.length) return 1;
  const body = normalizeComparableText(
    [project.description, project.hook, ...project.scenes.map((scene) => scene.narration)].join(' ')
  );
  const matched = titleTerms.filter((term) => body.includes(normalizeComparableText(term))).length;
  return matched / titleTerms.length;
}

function buildAuthenticityReport(project, profile, recentProjects) {
  const duplicateTitle = findExactDuplicate(project.title, recentProjects, 'title');
  const duplicateAngle = findExactDuplicate(project.originalAngle, recentProjects, 'originalAngle');
  const manipulativeTitle = /(100\s*%|무조건|충격|소름|안\s*보면\s*손해|반드시\s*성공|절대\s*실패)/i.test(project.title);
  if (duplicateTitle || duplicateAngle) {
    const duplicatedValue = duplicateTitle?.title || duplicateAngle?.originalAngle;
    throw new Error(`최근 영상과 제목 또는 고유 관점이 같습니다: "${duplicatedValue}". 새 관점으로 다시 생성해 주세요.`);
  }
  if (manipulativeTitle) {
    throw new Error('제목에 과도하거나 오해를 부를 수 있는 표현이 있어 생성을 중단했습니다. 주제를 더 구체적으로 바꿔 주세요.');
  }

  const alignment = calculateMetadataAlignment(project);
  return {
    outcome: 'manual-review-required',
    comparedRecentCount: recentProjects.length,
    checks: [
      {
        id: 'channel-theme',
        label: '채널 주제 일치',
        status: 'pass',
        detail: project.channelFit,
      },
      {
        id: 'viewer-value',
        label: '시청자 가치',
        status: 'pass',
        detail: project.viewerValue,
      },
      {
        id: 'recent-originality',
        label: '최근 생성 프로젝트 중복',
        status: 'pass',
        detail: `최근 성공 프로젝트 ${recentProjects.length}건과 주제, 제목, 고유 관점을 비교했습니다.`,
      },
      {
        id: 'creator-contribution',
        label: '제작자 기여',
        status: 'action',
        detail: project.creatorContribution,
      },
      {
        id: 'metadata-alignment',
        label: '제목·설명 일치',
        status: alignment >= 0.5 ? 'pass' : 'action',
        detail:
          alignment >= 0.5
            ? project.metadataPromise
            : `제목 핵심어와 대본의 자동 일치도가 낮습니다. 업로드 전에 직접 확인하세요. ${project.metadataPromise}`,
      },
      {
        id: 'latest-uploads',
        label: '최신 업로드 영상',
        status: 'manual',
        detail: '앱 밖에서 올렸거나 수정한 영상도 있으므로 실제 채널의 최신 영상들과 표현·구성 반복 여부를 직접 비교하세요.',
      },
      {
        id: 'top-watch-time',
        label: '인기·시청 시간 상위 영상',
        status: 'manual',
        detail: 'YouTube Studio 분석에서 상위 영상과 비교해 채널의 반복성 및 주제 일관성을 직접 확인하세요.',
      },
      {
        id: 'channel-about',
        label: '채널 소개',
        status: 'manual',
        detail: `현재 채널 소개가 핵심 주제 "${profile.channelTheme}"와 주요 시청자 "${profile.targetAudience}"를 정확히 설명하는지 확인하세요.`,
      },
    ],
    notice: '이 검토는 생성 프로젝트를 점검하는 보조 기능이며 YouTube 수익 창출 승인이나 정책 준수를 보장하지 않습니다.',
  };
}

function createJobFolderName(keyword, format) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeKeyword = keyword
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${timestamp}_${format}_${safeKeyword || 'youtube'}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDataUri(imagePath) {
  const extension = path.extname(imagePath).toLocaleLowerCase();
  const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mimeType};base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

function buildSceneImagePrompt(scene, request) {
  return [
    `Create an original stylized editorial illustration for a Korean YouTube ${request.format} video.`,
    scene.visualPrompt,
    `Compose for a ${request.config.aspectRatio} frame with the important subject inside the central safe area.`,
    'Use a distinctive visual concept for this scene instead of a generic reusable template.',
    'Do not depict an identifiable or famous person, a real event presented as fact, a copyrighted character, or recognizable branded products.',
    'No readable text, letters, numbers, logos, trademarks, labels, watermarks, UI screenshots, or before-and-after layout.',
    'Do not imply guaranteed medical, financial, legal, or product outcomes.',
  ].join(' ');
}

function renderSceneHtml({ project, scene, request, backgroundDataUri }) {
  const isShorts = request.format === 'shorts';
  const displayText = scene.index === 1 ? project.title : scene.onScreenText;
  const formatLabel = isShorts ? 'YOUTUBE SHORTS' : 'YOUTUBE VIDEO';
  const horizontalPadding = isShorts ? 82 : 126;
  const verticalPadding = isShorts ? 94 : 72;
  const titleSize = isShorts ? (scene.index === 1 ? 72 : 82) : scene.index === 1 ? 66 : 76;
  const safeWidth = isShorts ? 900 : 1500;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: ${request.config.width}px; height: ${request.config.height}px; margin: 0; }
      body { color: #ffffff; font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif; }
      .scene { position: relative; isolation: isolate; width: 100%; height: 100%; overflow: hidden; background: #171a20; }
      .background { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .scene::before { content: ""; position: absolute; z-index: 1; inset: 0; background: rgba(5, 8, 13, 0.48); }
      .content { position: relative; z-index: 2; display: flex; flex-direction: column; width: 100%; height: 100%; padding: ${verticalPadding}px ${horizontalPadding}px; }
      .topline { display: flex; align-items: center; justify-content: space-between; font-size: ${isShorts ? 23 : 22}px; font-weight: 700; }
      .format { border: 2px solid rgba(255,255,255,0.92); background: rgba(0,0,0,0.46); padding: 10px 14px; }
      .count { min-width: 96px; text-align: right; text-shadow: 0 2px 8px rgba(0,0,0,0.96); }
      .copy { width: 100%; max-width: ${safeWidth}px; margin-top: auto; margin-bottom: ${isShorts ? 96 : 36}px; padding: ${isShorts ? '32px 32px 36px' : '28px 34px 32px'}; border-left: 8px solid #ff5a4f; background: rgba(5,8,13,0.78); }
      .eyebrow { margin-bottom: 16px; color: #ff8b82; font-size: ${isShorts ? 26 : 24}px; font-weight: 700; }
      h1 { max-width: 100%; margin: 0; font-size: ${titleSize}px; line-height: 1.24; letter-spacing: 0; word-break: keep-all; overflow-wrap: break-word; text-shadow: 0 3px 12px rgba(0,0,0,0.96); }
      .footer { display: flex; justify-content: space-between; margin-top: 26px; padding-top: 18px; border-top: 2px solid rgba(255,255,255,0.52); font-size: ${isShorts ? 22 : 20}px; font-weight: 700; }
      .brand { color: #ff766d; }
    </style>
  </head>
  <body>
    <article class="scene">
      <img class="background" src="${backgroundDataUri}" alt="" />
      <div class="content">
        <div class="topline">
          <span class="format">${escapeHtml(formatLabel)}</span>
          <span class="count">${String(scene.index).padStart(2, '0')} / ${String(project.scenes.length).padStart(2, '0')}</span>
        </div>
        <div class="copy">
          <div class="eyebrow">${scene.index === 1 ? '오늘의 주제' : `핵심 ${String(scene.index).padStart(2, '0')}`}</div>
          <h1>${escapeHtml(displayText)}</h1>
          <div class="footer"><span class="brand">AUTOM CREATOR</span><span>ORIGINAL STORY</span></div>
        </div>
      </div>
    </article>
  </body>
</html>`;
}

async function renderScenes(project, request, workDir, onProgress) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  });

  try {
    const page = await browser.newPage({
      viewport: { width: request.config.width, height: request.config.height },
      deviceScaleFactor: 1,
    });
    const renderedScenes = [];

    for (const scene of project.scenes) {
      const framePath = path.join(workDir, `scene_${String(scene.index).padStart(2, '0')}.jpg`);
      await page.setContent(
        renderSceneHtml({
          project,
          scene,
          request,
          backgroundDataUri: toDataUri(scene.backgroundPath),
        }),
        { waitUntil: 'load' }
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: framePath, type: 'jpeg', quality: 90 });
      onProgress?.({ stage: 'rendering', current: scene.index, total: project.scenes.length });
      renderedScenes.push({
        ...scene,
        framePath,
        fileUrl: pathToFileURL(framePath).href,
      });
    }

    await page.close();
    return renderedScenes;
  } finally {
    await browser.close();
  }
}

function getFfmpegRevision() {
  const packageRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const registry = JSON.parse(fs.readFileSync(path.join(packageRoot, 'browsers.json'), 'utf8'));
  const descriptor = registry.browsers.find((browser) => browser.name === 'ffmpeg');
  if (!descriptor?.revision) throw new Error('Playwright FFmpeg 버전 정보를 찾지 못했습니다.');
  return descriptor.revision;
}

function getPlaywrightBrowserRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  return path.dirname(path.dirname(path.dirname(chromium.executablePath())));
}

function getFfmpegExecutablePath() {
  const revision = getFfmpegRevision();
  const executableName = process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux';
  const executablePath = path.join(getPlaywrightBrowserRoot(), `ffmpeg-${revision}`, executableName);
  if (!fs.existsSync(executablePath)) {
    throw new Error('영상 인코더가 설치 파일에 없습니다. 최신 AutoM Creator를 다시 설치해 주세요.');
  }
  return executablePath;
}

async function encodeVideo({ framePaths, durationSeconds, outputPath, onProgress }) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) {
    throw new Error('영상을 만들려면 장면 이미지가 2장 이상 필요합니다.');
  }

  const ffmpegPath = getFfmpegExecutablePath();
  const inputFrameRate = `${framePaths.length}/${durationSeconds}`;
  const child = spawn(
    ffmpegPath,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      inputFrameRate,
      '-vcodec',
      'mjpeg',
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libvpx',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-b:v',
      '4M',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(VIDEO_FPS),
      outputPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }
  );

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12000);
  });

  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  onProgress?.({ stage: 'encoding', current: 0, total: 1 });
  const pipeResultPromise = pipeStreams(
    Readable.from(framePaths.map((framePath) => fs.readFileSync(framePath))),
    child.stdin
  ).then(
    () => null,
    (error) => error
  );
  const exitCode = await exitPromise;
  const pipeError = await pipeResultPromise;

  if (exitCode !== 0) {
    throw new Error(`영상 파일을 만들지 못했습니다.${stderr.trim() ? ` ${stderr.trim()}` : ''}`);
  }
  if (pipeError) throw pipeError;
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 2048) {
    throw new Error('생성된 영상 파일이 비어 있습니다.');
  }
  onProgress?.({ stage: 'encoding', current: 1, total: 1 });
  return outputPath;
}

function attachTimings(scenes, durationSeconds) {
  return scenes.map((scene, index) => {
    const startSeconds = (durationSeconds * index) / scenes.length;
    const endSeconds = (durationSeconds * (index + 1)) / scenes.length;
    return { ...scene, startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
  });
}

function formatClock(seconds, { srt = false } = {}) {
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const separator = srt ? ',' : '.';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

function buildScriptText(project, request) {
  const lines = [
    project.title,
    '',
    `형식: ${request.config.label} ${request.durationSeconds}초`,
    `고유 관점: ${project.originalAngle}`,
    '',
  ];
  for (const scene of project.scenes) {
    lines.push(
      `[${formatClock(scene.startSeconds)} - ${formatClock(scene.endSeconds)}] 장면 ${scene.index}`,
      `화면 문구: ${scene.onScreenText}`,
      scene.narration,
      ''
    );
  }
  lines.push('마무리', project.callToAction);
  if (project.disclaimer) lines.push('', '주의 고지', project.disclaimer);
  return lines.join('\n').trim();
}

function buildSrtText(scenes) {
  return scenes
    .map(
      (scene, index) =>
        `${index + 1}\n${formatClock(scene.startSeconds, { srt: true })} --> ${formatClock(scene.endSeconds, { srt: true })}\n${scene.narration}`
    )
    .join('\n\n');
}

function buildDescriptionText(project) {
  return `${project.description}\n\n${AI_VISUAL_DISCLOSURE}\n\n${project.tags.map((tag) => `#${tag}`).join(' ')}`;
}

function writeProjectFiles(workDir, content, request) {
  const scriptText = buildScriptText(content, request);
  const srtText = buildSrtText(content.scenes);
  const descriptionText = buildDescriptionText(content);
  const checklist = [
    'YouTube 업로드 전 확인',
    '',
    '1. 대본의 날짜, 수치, 건강·금융·법률 관련 주장을 직접 확인합니다.',
    '2. 직접 녹음한 목소리와 자신의 해설·경험을 추가해 반복형 콘텐츠가 되지 않게 합니다.',
    '3. 사실처럼 보이는 AI 생성 장면이 있다면 YouTube Studio의 AI 사용 항목을 예로 선택합니다.',
    '4. 음악과 추가 영상은 직접 제작했거나 상업적 사용 권한이 있는 자료만 사용합니다.',
    '5. 아동용 콘텐츠, 유료 프로모션, 공개 범위를 실제 영상에 맞게 선택합니다.',
    '6. 제목, 첫 화면(썸네일), 설명에서 약속한 내용이 실제 대본에 있는지 확인합니다.',
    '7. YouTube Studio에서 가장 많이 본 영상과 시청 시간 상위 영상을 비교해 획일적 반복이 없는지 확인합니다.',
    '8. 채널 소개가 실제 핵심 주제와 주요 시청자를 정확하게 설명하는지 확인합니다.',
    '',
    '채널 검토 결과',
    ...content.authenticityReport.checks.map(
      (check) => `- [${check.status === 'pass' ? '자동 확인' : '직접 확인'}] ${check.label}: ${check.detail}`
    ),
    '',
    content.authenticityReport.notice,
  ];
  if (content.factCheckNotes.length) {
    checklist.push('', '사실 확인 항목', ...content.factCheckNotes.map((note) => `- ${note}`));
  }

  const scriptPath = path.join(workDir, 'script.txt');
  const srtPath = path.join(workDir, 'captions.srt');
  const metadataPath = path.join(workDir, 'metadata.txt');
  const checklistPath = path.join(workDir, 'upload-checklist.txt');
  const projectPath = path.join(workDir, 'project.json');
  const channelReviewPath = path.join(workDir, 'channel-review.txt');
  const thumbnailPath = path.join(workDir, 'thumbnail.jpg');

  fs.writeFileSync(scriptPath, scriptText, 'utf8');
  fs.writeFileSync(srtPath, srtText, 'utf8');
  fs.writeFileSync(
    metadataPath,
    `제목\n${content.title}\n\n설명\n${descriptionText}\n\n마무리 문장\n${content.callToAction}`,
    'utf8'
  );
  fs.writeFileSync(checklistPath, checklist.join('\n'), 'utf8');
  fs.writeFileSync(
    channelReviewPath,
    [
      '채널 핵심 주제',
      content.channelProfile.channelTheme,
      '',
      '주요 시청자',
      content.channelProfile.targetAudience,
      '',
      '채널 소개 초안',
      content.channelAboutDraft,
      '',
      '제작자 기여 지점',
      content.creatorContribution,
      '',
      ...content.authenticityReport.checks.map((check) => `[${check.status}] ${check.label}\n${check.detail}\n`),
      content.authenticityReport.notice,
    ].join('\n'),
    'utf8'
  );
  fs.copyFileSync(content.scenes[0].framePath, thumbnailPath);
  fs.writeFileSync(
    projectPath,
    JSON.stringify(
      {
        keyword: content.keyword,
        format: request.format,
        durationSeconds: request.durationSeconds,
        resolution: `${request.config.width}x${request.config.height}`,
        fps: VIDEO_FPS,
        title: content.title,
        hook: content.hook,
        description: content.description,
        tags: content.tags,
        originalAngle: content.originalAngle,
        channelFit: content.channelFit,
        viewerValue: content.viewerValue,
        creatorContribution: content.creatorContribution,
        metadataPromise: content.metadataPromise,
        channelAboutDraft: content.channelAboutDraft,
        channelProfile: content.channelProfile,
        authenticityReport: content.authenticityReport,
        callToAction: content.callToAction,
        disclaimer: content.disclaimer,
        factCheckNotes: content.factCheckNotes,
        videoPath: content.videoPath,
        scenes: content.scenes.map((scene) => ({
          index: scene.index,
          startSeconds: scene.startSeconds,
          endSeconds: scene.endSeconds,
          onScreenText: scene.onScreenText,
          narration: scene.narration,
          visualPrompt: scene.visualPrompt,
          backgroundPath: scene.backgroundPath,
          framePath: scene.framePath,
        })),
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    scriptText,
    descriptionText,
    scriptPath,
    srtPath,
    metadataPath,
    checklistPath,
    channelReviewPath,
    projectPath,
    thumbnailPath,
  };
}

async function generateYoutubeProject({
  keyword,
  format,
  durationSeconds,
  sceneCount,
  contentStyle,
  channelTheme,
  targetAudience,
  creatorPerspective,
  recentProjects = [],
  settings,
  onProgress,
}) {
  const normalizedKeyword = validateKeyword(keyword);
  const request = youtubeSchema.normalizeRequest({ format, durationSeconds, sceneCount, contentStyle });
  const channelProfile = youtubeSchema.normalizeChannelProfile({ channelTheme, targetAudience, creatorPerspective });
  const normalizedRecentProjects = youtubeSchema.normalizeRecentProjects(recentProjects);
  assertUniqueTopic(normalizedKeyword, normalizedRecentProjects);
  const textConfig = resolveConfiguredProvider(settings, 'text', textProviders);
  const imageConfig = resolveConfiguredProvider(settings, 'image', imageProviders);
  const outputFolder = String(settings?.outputFolder || '').trim();
  if (!outputFolder) throw new Error('설정에서 저장 폴더를 먼저 선택해 주세요.');

  const workDir = path.join(outputFolder, 'youtube', createJobFolderName(normalizedKeyword, request.format));
  fs.mkdirSync(workDir, { recursive: true });
  const textProvider = textProviders.get(textConfig.providerId);
  const imageProvider = imageProviders.get(imageConfig.providerId);

  onProgress?.({ stage: 'writing', current: 0, total: request.sceneCount });
  const draft = await textProvider.generateYoutubeProject({
    keyword: normalizedKeyword,
    format: request.format,
    durationSeconds: request.durationSeconds,
    sceneCount: request.sceneCount,
    contentStyle: request.contentStyle,
    ...channelProfile,
    recentProjects: normalizedRecentProjects,
    model: textConfig.model,
    apiKey: textConfig.apiKey,
  });

  const authenticityReport = buildAuthenticityReport(
    draft,
    channelProfile,
    normalizedRecentProjects
  );

  let completedImageCount = 0;
  onProgress?.({ stage: 'illustrating', current: 0, total: draft.scenes.length });
  const scenesWithBackgrounds = await mapWithConcurrency(
    draft.scenes,
    IMAGE_GENERATION_CONCURRENCY,
    async (scene) => {
      const backgroundPath = path.join(workDir, `background_${String(scene.index).padStart(2, '0')}.png`);
      await imageProvider.generateImage({
        prompt: buildSceneImagePrompt(scene, request),
        model: imageConfig.model,
        apiKey: imageConfig.apiKey,
        outputPath: backgroundPath,
      });
      completedImageCount += 1;
      onProgress?.({ stage: 'illustrating', current: completedImageCount, total: draft.scenes.length });
      return { ...scene, backgroundPath };
    }
  );

  const renderProject = { ...draft, scenes: scenesWithBackgrounds };
  const renderedScenes = await renderScenes(renderProject, request, workDir, onProgress);
  const timedScenes = attachTimings(renderedScenes, request.durationSeconds);
  const videoPath = path.join(workDir, `${request.format}.webm`);
  await encodeVideo({
    framePaths: timedScenes.map((scene) => scene.framePath),
    durationSeconds: request.durationSeconds,
    outputPath: videoPath,
    onProgress,
  });

  const content = {
    keyword: normalizedKeyword,
    workDir,
    format: request.format,
    formatLabel: request.config.label,
    durationSeconds: request.durationSeconds,
    resolution: `${request.config.width}x${request.config.height}`,
    ...draft,
    scenes: timedScenes,
    videoPath,
    videoFileUrl: pathToFileURL(videoPath).href,
    aiDisclosureRecommended: true,
    channelProfile,
    authenticityReport,
  };
  Object.assign(content, writeProjectFiles(workDir, content, request));
  onProgress?.({ stage: 'done', current: content.scenes.length, total: content.scenes.length });
  return content;
}

module.exports = {
  generateYoutubeProject,
  _test: {
    validateKeyword,
    createJobFolderName,
    buildSceneImagePrompt,
    renderSceneHtml,
    getFfmpegExecutablePath,
    encodeVideo,
    attachTimings,
    formatClock,
    buildScriptText,
    buildSrtText,
    buildDescriptionText,
    normalizeComparableText,
    assertUniqueTopic,
    calculateMetadataAlignment,
    buildAuthenticityReport,
  },
};
