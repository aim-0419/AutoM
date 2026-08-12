/**
 * [유튜브 영상 초안 제작 공정]
 *
 * 비개발자를 위한 설명:
 * - 키워드 하나로 유튜브 영상의 '초안 한 세트'를 만듭니다. 자동 업로드는 하지 않습니다.
 *   (직접 목소리를 녹음하고 편집해서 올리는 것을 전제로 한 재료 모음입니다)
 *
 * - 만드는 순서:
 *     1) 글쓰기 AI에게 제목·설명·장면별 대본을 받는다.          (stage: writing)
 *     2) 이미지 AI에게 장면마다 배경 그림을 만든다. (2장씩 동시) (stage: illustrating)
 *     3) 배경 위에 화면 문구를 얹어 장면 이미지를 완성한다.      (stage: rendering)
 *     4) 장면 이미지들을 이어 붙여 소리 없는 영상 파일을 만든다. (stage: encoding)
 *     5) 대본·자막·설명문·업로드 체크리스트를 파일로 저장한다.   (stage: done)
 *
 * - 결과 폴더에 생기는 파일들:
 *     shorts.webm / longform.webm : 소리 없는 영상 초안 (여기에 목소리를 입히면 됩니다)
 *     script.txt         : 시간대별 대본
 *     captions.srt       : 자막 파일 (유튜브에 그대로 올릴 수 있는 표준 형식)
 *     metadata.txt       : 유튜브에 붙여넣을 제목·설명
 *     upload-checklist.txt: 업로드 전 직접 확인해야 할 항목 목록
 *     channel-review.txt : 채널 방향성 점검 결과
 *     thumbnail.jpg      : 첫 장면으로 만든 썸네일 후보
 *     project.json       : 위 모든 정보를 담은 데이터 파일
 *
 * - 왜 자동 업로드를 하지 않나요?
 *   유튜브는 AI로만 만든 반복 콘텐츠에 엄격합니다. 그래서 이 프로그램은 '재료'까지만 만들고,
 *   본인의 목소리·해설·경험을 더하도록 안내합니다. 그 안내가 upload-checklist.txt입니다.
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

const IMAGE_GENERATION_CONCURRENCY = 2; // 배경 그림을 한 번에 2장씩 생성
const VIDEO_FPS = 24; // 영상의 초당 화면 수 (일반 영화와 같은 부드러움)
// 유튜브 설명란에 자동으로 넣는 AI 사용 고지 문구. 시청자에 대한 투명성 확보용이다.
const AI_VISUAL_DISCLOSURE = '※ 일부 시각 자료는 AI로 제작되었습니다.';

/** 주제가 1~120자인지 확인하고 공백을 정리한다. */
function validateKeyword(keyword) {
  const value = String(keyword || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!value || [...value].length > 120) {
    throw new Error('주제는 1~120자로 입력해 주세요.');
  }
  return value;
}

/**
 * 두 문장이 '사실상 같은지' 비교하기 위해 형태를 통일한다.
 * 띄어쓰기·기호·대소문자를 모두 없애서, "AI 활용법"과 "ai활용법"을 같은 것으로 본다.
 */
function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^0-9a-z가-힣]+/g, '');
}

/** 최근 만든 영상 중 특정 항목(주제/제목/관점)이 완전히 같은 것이 있는지 찾는다. */
function findExactDuplicate(value, recentProjects, field) {
  const normalized = normalizeComparableText(value);
  if (!normalized) return null;
  return recentProjects.find((item) => normalizeComparableText(item?.[field]) === normalized) || null;
}

/**
 * 최근에 같은 주제로 영상을 만든 적이 있으면 시작 전에 중단한다.
 * 비슷한 영상이 반복되면 채널이 '대량 생산 콘텐츠'로 평가받아 불이익을 받을 수 있기 때문이다.
 */
function assertUniqueTopic(keyword, recentProjects) {
  const duplicate = findExactDuplicate(keyword, recentProjects, 'keyword');
  if (duplicate) {
    throw new Error(
      `최근에 같은 주제로 YouTube 프로젝트를 만들었습니다: "${duplicate.title || duplicate.keyword}". 새 주제나 분명히 다른 관점으로 입력해 주세요.`
    );
  }
}

/**
 * 제목이 약속한 내용이 실제 대본에 들어 있는지 점수(0~1)로 계산한다.
 *
 * 방법: 제목에서 핵심 단어를 뽑고, 그 단어들이 설명·대본에 실제로 나오는 비율을 센다.
 * 왜 필요한가요? 제목은 자극적인데 내용은 다른 '낚시 영상'이 되지 않게 하기 위해서다.
 * 점수가 0.5 미만이면 "직접 확인하세요"라고 안내한다.
 */
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

/**
 * [채널 검토 보고서] 이 영상이 채널 운영에 문제가 없는지 점검한 결과를 만든다.
 *
 * 먼저 아래 두 가지는 발견 즉시 생성을 '중단'한다.
 *   · 최근 영상과 제목 또는 고유 관점이 완전히 같은 경우
 *   · 제목에 "100%", "무조건", "충격", "안 보면 손해" 같은 과장·낚시 표현이 있는 경우
 *
 * 나머지는 8개 항목의 점검표로 만들어 결과 폴더에 저장한다. 각 항목의 상태는 세 가지다.
 *   pass   : 프로그램이 자동으로 확인 완료
 *   action : 사용자가 손봐야 할 부분 (예: 본인의 해설 추가)
 *   manual : 프로그램이 알 수 없어 사용자가 직접 확인해야 함 (예: 실제 채널의 최근 영상 비교)
 *
 * ※ 이 검토는 보조 도구일 뿐, 유튜브의 수익 창출 승인이나 정책 통과를 보장하지 않는다.
 */
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

/**
 * 장면 배경 그림을 만들기 위한 지시문(영어)을 조립한다.
 *
 * 반드시 넣는 금지 조건들:
 *  · 실존 인물, 실제 사건, 저작권 캐릭터, 알아볼 수 있는 브랜드 제품을 그리지 말 것
 *  · 읽을 수 있는 글자·숫자·로고·워터마크를 넣지 말 것 (글자는 우리가 직접 얹는다)
 *  · 의학·금융·법률 결과를 보장하는 듯한 표현을 넣지 말 것
 * → 저작권 문제와 허위 정보 위험을 미리 차단하기 위한 조치다.
 */
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

/**
 * 장면 한 컷의 화면을 웹페이지(HTML)로 그린다. 이 페이지를 캡처하면 영상의 한 장면이 된다.
 *
 * 화면 구성: 배경 그림 위에 어두운 막 → 상단에 형식/장면 번호 → 하단에 큰 화면 문구
 * 쇼츠(세로)와 롱폼(가로)은 화면 비율이 달라 글자 크기와 여백을 각각 다르게 계산한다.
 * 중요한 내용은 화면 가운데 쪽에 배치해, 휴대폰에서 잘려도 보이도록 한다.
 */
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

// ── 영상 만들기(인코딩) 관련 ─────────────────────────────────────
// FFmpeg는 이미지들을 이어 붙여 동영상 파일로 만들어 주는 표준 도구입니다.
// 별도로 설치하지 않아도 되도록, 프로그램에 함께 들어 있는 것을 찾아서 사용합니다.
// 아래 세 함수는 "그 도구가 어느 폴더에 있는지" 찾아내는 역할을 합니다.

/** 프로그램에 포함된 FFmpeg의 버전 번호를 확인한다. (폴더 이름에 버전이 들어가기 때문) */
function getFfmpegRevision() {
  const packageRoot = path.dirname(require.resolve('playwright-core/package.json'));
  const registry = JSON.parse(fs.readFileSync(path.join(packageRoot, 'browsers.json'), 'utf8'));
  const descriptor = registry.browsers.find((browser) => browser.name === 'ffmpeg');
  if (!descriptor?.revision) throw new Error('Playwright FFmpeg 버전 정보를 찾지 못했습니다.');
  return descriptor.revision;
}

/** 브라우저와 FFmpeg가 설치된 최상위 폴더를 찾는다. (개발 중과 설치본의 위치가 다르다) */
function getPlaywrightBrowserRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    return path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  return path.dirname(path.dirname(path.dirname(chromium.executablePath())));
}

/** FFmpeg 실행 파일의 정확한 경로를 돌려준다. 없으면 재설치를 안내한다. */
function getFfmpegExecutablePath() {
  const revision = getFfmpegRevision();
  const executableName = process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux';
  const executablePath = path.join(getPlaywrightBrowserRoot(), `ffmpeg-${revision}`, executableName);
  if (!fs.existsSync(executablePath)) {
    throw new Error('영상 인코더가 설치 파일에 없습니다. 최신 AutoM Creator를 다시 설치해 주세요.');
  }
  return executablePath;
}

/**
 * 장면 이미지들을 이어 붙여 소리 없는 영상 파일(.webm)을 만든다.
 *
 * 비개발자를 위한 설명:
 * - 예를 들어 장면 6개로 60초 영상을 만든다면, 한 장면당 10초씩 화면에 머무릅니다.
 *   아래 `inputFrameRate`가 그 계산(장면 수 ÷ 영상 길이)입니다.
 * - 이미지를 임시 파일로 저장했다가 읽는 대신, 메모리에서 FFmpeg에 바로 흘려보냅니다(pipe).
 *   디스크를 거치지 않아 더 빠르고 찌꺼기 파일도 남지 않습니다.
 * - 소리는 넣지 않습니다(-an). 사용자가 직접 목소리를 녹음해 입히는 것을 전제로 하기 때문입니다.
 * - 마지막에 파일이 실제로 만들어졌고 크기가 정상인지(2KB 이상) 확인합니다.
 */
async function encodeVideo({ framePaths, durationSeconds, outputPath, onProgress }) {
  if (!Array.isArray(framePaths) || framePaths.length < 2) {
    throw new Error('영상을 만들려면 장면 이미지가 2장 이상 필요합니다.');
  }

  const ffmpegPath = getFfmpegExecutablePath();
  // 장면 수 ÷ 영상 길이 = 초당 몇 장면을 보여줄지. 예) 6장면 / 60초 → 장면당 10초
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

/**
 * 각 장면이 영상의 몇 초부터 몇 초까지인지 계산해 붙인다.
 * 전체 길이를 장면 수로 똑같이 나눈다. 이 값은 자막 파일(.srt)의 타이밍이 된다.
 * 예) 60초 영상 / 장면 4개 → 0~15초, 15~30초, 30~45초, 45~60초
 */
function attachTimings(scenes, durationSeconds) {
  return scenes.map((scene, index) => {
    const startSeconds = (durationSeconds * index) / scenes.length;
    const endSeconds = (durationSeconds * (index + 1)) / scenes.length;
    return { ...scene, startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds };
  });
}

/**
 * 초를 시:분:초.밀리초 형태의 시간 표기로 바꾼다. (예: 75.5 → 00:01:15.500)
 * 자막 파일(.srt)은 소수점 대신 쉼표를 쓰는 규칙이 있어 srt: true일 때 구분자를 바꾼다.
 */
function formatClock(seconds, { srt = false } = {}) {
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const separator = srt ? ',' : '.';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(milliseconds).padStart(3, '0')}`;
}

/** 녹음할 때 보고 읽을 대본(script.txt) 내용을 만든다. 장면별 시간과 대사가 함께 적힌다. */
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

/**
 * 자막 파일(.srt) 내용을 만든다. SRT는 유튜브를 포함해 대부분의 영상 도구가 읽는 표준 형식이다.
 * 형식: 번호 → 시작시각 --> 끝시각 → 자막 내용 (빈 줄로 구분)
 */
function buildSrtText(scenes) {
  return scenes
    .map(
      (scene, index) =>
        `${index + 1}\n${formatClock(scene.startSeconds, { srt: true })} --> ${formatClock(scene.endSeconds, { srt: true })}\n${scene.narration}`
    )
    .join('\n\n');
}

/** 유튜브 설명란에 넣을 글을 만든다. 설명 + AI 사용 고지 + 해시태그 순서다. */
function buildDescriptionText(project) {
  return `${project.description}\n\n${AI_VISUAL_DISCLOSURE}\n\n${project.tags.map((tag) => `#${tag}`).join(' ')}`;
}

/**
 * 결과 폴더에 사용자가 쓸 파일들을 모두 저장한다.
 * (대본 / 자막 / 제목·설명 / 업로드 체크리스트 / 채널 검토서 / 썸네일 / 전체 데이터)
 * 썸네일은 첫 번째 장면 이미지를 복사해 만든다.
 */
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

/**
 * [메인 함수] 키워드 하나로 유튜브 영상 초안 한 세트를 완성한다.
 * 화면의 '영상 만들기' 버튼이 최종적으로 실행하는 기능이다.
 */
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
