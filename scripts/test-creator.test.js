const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const instagramSchema = require('../backend/core/providers/text/instagramSchema');
const youtubeSchema = require('../backend/core/providers/text/youtubeSchema');
const instagramPipeline = require('../backend/features/instagram/pipeline');
const youtubePipeline = require('../backend/features/youtube/pipeline');
const textProviders = require('../backend/core/providers/text');
const imageProviders = require('../backend/core/providers/image');
const instagramPublisher = require('../backend/features/instagram/publisher');
const instagramSession = require('../backend/features/instagram/session');
const creatorIpc = require('../backend/apps/creator/ipc');
const { resolveConfiguredProvider } = require('../backend/core/providers/configuredProvider');
const { getApiKeyPageUrl } = require('../backend/core/providers/apiKeyPages');

function buildValidResponse(cardCount = 3) {
  return JSON.stringify({
    title: '비타민B12 부족 신호를 확인하는 카드뉴스',
    cards: Array.from({ length: cardCount }, (_, index) => ({
      headline: `확인 항목 ${index + 1}을 먼저 살펴보세요`,
      body: '몸의 변화는 한 가지 이유로 단정하기보다 식사와 생활 습관을 함께 기록하며 차분하게 확인하는 편이 도움이 됩니다.',
      imagePrompt: 'A calm editorial still life on a clean table with soft natural light and ample negative space, no text or logo',
    })),
    caption:
      '비타민B12와 관련된 변화는 단순한 피로감만으로 판단하기 어렵습니다. 식사 패턴과 생활 습관을 함께 살펴보고, 불편이 이어진다면 필요한 검사를 전문가와 상의하는 편이 좋습니다. 이 카드에는 일상에서 먼저 확인할 수 있는 기준을 정리했습니다. 급하게 결론을 내리기보다 기록을 남기며 자신의 상황에 맞는 다음 선택을 찾아보세요.',
    tags: ['비타민B12', '영양정보', '식단관리', '건강기록', '생활습관'],
    callToAction: '필요할 때 다시 볼 수 있도록 저장해 두세요.',
  });
}

function buildValidYoutubeResponse(sceneCount = 4) {
  const screenTexts = ['오늘의 습관 기록', '한 가지 기준 선택', '일주일 흐름 확인', '다음 행동 정하기'];
  const narrations = [
    '먼저 오늘 반복되는 생활 습관을 짧게 기록하면 바꿀 지점을 구체적으로 찾을 수 있습니다.',
    '한 번에 모두 바꾸기보다 가장 불편한 시간대와 행동 하나를 골라 작은 기준부터 세워보세요.',
    '일주일 동안 같은 기준으로 살펴보면 기분에 따른 판단보다 실제 변화의 흐름을 확인하기 쉽습니다.',
    '기록한 내용을 돌아보고 계속할 한 가지를 정하면 무리하지 않고 다음 행동으로 이어갈 수 있습니다.',
  ];

  return JSON.stringify({
    title: '아침 피로를 줄이기 위해 먼저 확인할 생활 습관',
    hook: '아침마다 피곤하다면 잠든 시간만 확인해서는 놓치는 부분이 있습니다.',
    description:
      '아침의 피로감은 한 가지 이유로 단정하기 어렵습니다. 이 영상에서는 하루의 생활 습관을 기록하고, 바꿀 기준을 하나씩 선택하며, 일주일 동안 변화의 흐름을 확인하는 방법을 정리합니다. 자신의 상황을 차분히 살펴보고 불편이 계속된다면 필요한 도움을 전문가와 상의하세요.',
    tags: ['아침피로', '생활습관', '수면기록', '건강정보', '일상관리'],
    originalAngle: '막연한 피로 원인 나열보다 사용자가 직접 기록하고 확인할 수 있는 순서를 제공합니다.',
    channelFit: '생활 습관을 직접 기록하고 바꾸는 채널의 핵심 주제와 직장인 시청자의 일상에 맞습니다.',
    viewerValue: '시청자는 막연한 피로감을 생활 기록으로 구체화하고 다음 행동 하나를 정하는 방법을 얻습니다.',
    creatorContribution: '직접 녹음할 때 실제로 기록해 본 시간대와 적용하기 어려웠던 지점을 솔직하게 덧붙입니다.',
    metadataPromise: '제목에서 약속한 생활 습관 확인 순서를 도입과 네 장면의 기록 단계에서 모두 설명합니다.',
    channelAboutDraft:
      '바쁜 직장인이 일상에서 직접 확인하고 실천할 수 있는 현실적인 건강 습관을 정리합니다. 과장된 결과보다 기록과 작은 행동 변화를 중심으로 설명합니다.',
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      onScreenText: screenTexts[index] || `확인 단계 ${index + 1}`,
      narration: narrations[index] || '기록한 기준을 차분히 비교하면 다음에 바꿀 행동을 구체적으로 정할 수 있습니다.',
      visualPrompt:
        'An original stylized editorial illustration of a calm morning routine with abstract shapes and centered composition, no text or logo',
    })),
    callToAction: '오늘 확인할 한 가지를 정하고 일주일 동안 기록해 보세요.',
    disclaimer: '이 영상은 일반적인 정보이며 의학적 진단이나 치료를 대신하지 않습니다.',
    factCheckNotes: ['피로가 지속될 때 전문가 상담이 필요한 기준을 게시 전에 확인합니다.'],
  });
}

test('인스타 카드뉴스 응답은 카드 수와 텍스트 길이를 검증한다', () => {
  const parsed = instagramSchema.parseInstagramCarouselResponse(buildValidResponse(3), { cardCount: 3 });
  const prompt = instagramSchema.buildSystemPrompt({ cardCount: 3 });
  assert.equal(parsed.cards.length, 3);
  assert.equal(parsed.tags.length, 5);
  assert.equal(parsed.title.includes('비타민B12'), true);
  assert.match(prompt, /특정 콘텐츠 분야로 제한하지 마세요/);
  assert.match(prompt, /건강·의료 주제/);
  assert.match(prompt, /금융·투자 주제/);
  assert.match(prompt, /법률 주제/);
});

test('카드 수 또는 중복 해시태그가 맞지 않으면 생성 결과를 거절한다', () => {
  assert.throws(
    () => instagramSchema.parseInstagramCarouselResponse(buildValidResponse(3), { cardCount: 5 }),
    /정확히 5개/
  );
  const invalidTags = JSON.parse(buildValidResponse(3));
  invalidTags.tags[4] = invalidTags.tags[0];
  assert.throws(
    () => instagramSchema.parseInstagramCarouselResponse(JSON.stringify(invalidTags), { cardCount: 3 }),
    /반복/
  );
});

test('인스타 카드 HTML은 입력 문자를 안전하게 이스케이프하고 4:5 캔버스를 유지한다', () => {
  const html = instagramPipeline._test.renderCardHtml({
    title: '<제목>',
    card: { headline: '제목', body: '본문 <script>', backgroundPath: 'unused.png' },
    cardIndex: 2,
    cardCount: 5,
    backgroundDataUri: 'data:image/png;base64,AA==',
  });
  assert.match(html, /width: 1080px/);
  assert.match(html, /height: 1350px/);
  assert.match(html, /\.background \{ position: absolute; z-index: 0;/);
  assert.match(html, /\.card::before \{ content: ""; position: absolute; z-index: 1;/);
  assert.match(html, /\.content \{ position: relative; z-index: 2;/);
  assert.match(html, /background: rgba\(6, 10, 16, 0\.60\)/);
  assert.match(html, /text-shadow:/);
  assert.match(html, /word-break: keep-all/);
  assert.match(html, /overflow-wrap: break-word/);
  assert.doesNotMatch(html, /overflow-wrap: anywhere/);
  assert.match(html, /본문 &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('이미지 작업은 최대 2개만 동시에 실행하고 원래 카드 순서를 유지한다', async () => {
  let activeCount = 0;
  let maxActiveCount = 0;
  const started = [];

  const results = await instagramPipeline._test.mapWithConcurrency(
    [1, 2, 3, 4, 5],
    instagramPipeline._test.IMAGE_GENERATION_CONCURRENCY,
    async (value) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      started.push(value);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 5 : 15));
      activeCount -= 1;
      return value * 10;
    }
  );

  assert.equal(maxActiveCount, 2);
  assert.deepEqual(started.slice(0, 2), [1, 2]);
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
});

test('YouTube 대본은 영상 길이, 장면 수와 정책용 필드를 검증한다', () => {
  const options = {
    format: 'shorts',
    durationSeconds: 30,
    sceneCount: 4,
    contentStyle: 'educational',
    channelTheme: '직장인의 현실적인 건강 습관',
    targetAudience: '건강 습관을 만들고 싶은 직장인',
    creatorPerspective: '직접 생활 기록을 하며 작은 행동부터 바꾸고 있습니다.',
  };
  const parsed = youtubeSchema.parseYoutubeProjectResponse(buildValidYoutubeResponse(4), options);
  assert.equal(parsed.scenes.length, 4);
  assert.equal(parsed.tags.length, 5);
  assert.ok(parsed.narrationLength >= 60 && parsed.narrationLength <= 210);
  assert.match(youtubeSchema.buildSystemPrompt(options), /반복 템플릿은 만들지 마세요/);
  assert.match(youtubeSchema.buildSystemPrompt(options), /실존 인물/);
  assert.match(youtubeSchema.buildSystemPrompt(options), /채널의 핵심 주제/);
  assert.match(youtubeSchema.buildSystemPrompt(options), /영상 주제가 어떤 분야든 그대로 다루고/);
  assert.match(youtubeSchema.buildSystemPrompt(options), /금융·투자 주제/);
  assert.match(
    youtubeSchema.buildUserPrompt({
      keyword: '아침 피로 생활 습관',
      ...options,
      recentProjects: [{ keyword: '수면 기록', title: '일주일 수면 기록', originalAngle: '시간대 비교' }],
    }),
    /최근 생성 영상:[\s\S]*일주일 수면 기록/
  );

  assert.throws(
    () => youtubeSchema.parseYoutubeProjectResponse(buildValidYoutubeResponse(4), { ...options, sceneCount: 5 }),
    /정확히 5개/
  );
  assert.equal(
    youtubeSchema.normalizeRequest({
      format: 'longform',
      durationSeconds: 300,
      sceneCount: 10,
      contentStyle: 'story',
    }).config.aspectRatio,
    '16:9'
  );
});

test('세 플랫폼 입력 예시는 특정 콘텐츠 분야에 고정되지 않는다', () => {
  const blogSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'blog', 'views', 'main.js'), 'utf8');
  const instagramSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'views', 'instagram.js'),
    'utf8'
  );
  const youtubeSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'views', 'youtube.js'),
    'utf8'
  );
  const settingsSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'blog', 'views', 'settings.js'),
    'utf8'
  );

  assert.match(blogSource, /초보 홈카페 원두 고르기/);
  assert.match(instagramSource, /작은 집 수납 공간 정리 방법/);
  assert.match(youtubeSource, /일상에서 바로 쓰는 디지털 활용법/);
  assert.match(settingsSource, /민감 정보 주제에 맞춤 고지문 자동 삽입/);
});

test('YouTube 장면은 어절 보존, 안전 영역과 원본성 표시를 사용한다', () => {
  const request = youtubeSchema.normalizeRequest({
    format: 'shorts',
    durationSeconds: 30,
    sceneCount: 4,
    contentStyle: 'educational',
  });
  const project = youtubeSchema.parseYoutubeProjectResponse(buildValidYoutubeResponse(4), request);
  const html = youtubePipeline._test.renderSceneHtml({
    project,
    scene: project.scenes[0],
    request,
    backgroundDataUri: 'data:image/png;base64,AA==',
  });
  assert.match(html, /width: 1080px/);
  assert.match(html, /height: 1920px/);
  assert.match(html, /word-break: keep-all/);
  assert.match(html, /overflow-wrap: break-word/);
  assert.doesNotMatch(html, /overflow-wrap: anywhere/);
  assert.match(html, /ORIGINAL STORY/);

  const imagePrompt = youtubePipeline._test.buildSceneImagePrompt(project.scenes[0], request);
  assert.match(imagePrompt, /identifiable or famous person/);
  assert.match(imagePrompt, /No readable text/);
});

test('YouTube 최근 성공 기록과 같은 주제 또는 관점은 이미지 생성 전에 차단한다', () => {
  assert.throws(
    () =>
      youtubePipeline._test.assertUniqueTopic('아침 피로 생활 습관', [
        { keyword: '아침피로 생활습관', title: '기존 영상' },
      ]),
    /같은 주제/
  );

  const project = youtubeSchema.parseYoutubeProjectResponse(buildValidYoutubeResponse(4), {
    format: 'shorts',
    durationSeconds: 30,
    sceneCount: 4,
    contentStyle: 'educational',
  });
  assert.throws(
    () =>
      youtubePipeline._test.buildAuthenticityReport(
        project,
        { channelTheme: '직장인의 건강 습관', targetAudience: '직장인' },
        [{ originalAngle: project.originalAngle }]
      ),
    /고유 관점/
  );
});

test('인스타 카드 입력값은 안전한 범위로 제한한다', () => {
  assert.equal(instagramPipeline._test.validateCardCount(3), 3);
  assert.equal(instagramPipeline._test.validateCardCount(10), 10);
  assert.throws(() => instagramPipeline._test.validateCardCount(11), /3~10/);
  assert.throws(() => instagramPipeline._test.validateKeyword(''), /1~100/);
});

test('가짜 AI 응답으로 카드 PNG와 캡션 묶음을 실제로 만든다', { concurrency: false }, async () => {
  const outputFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'autom-creator-test-'));
  const originalTextGet = textProviders.get;
  const originalImageGet = imageProviders.get;
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JxS8AAAAASUVORK5CYII=',
    'base64'
  );

  try {
    textProviders.get = () => ({
      generateInstagramCarousel: async () => instagramSchema.parseInstagramCarouselResponse(buildValidResponse(3), { cardCount: 3 }),
    });
    imageProviders.get = () => ({
      generateImage: async ({ outputPath }) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, onePixelPng);
        return outputPath;
      },
    });

    const content = await instagramPipeline.generateCarousel({
      keyword: '비타민B12 식단 관리',
      cardCount: 3,
      settings: {
        text: { provider: 'fake-text', apiKeys: { 'fake-text': 'text-key' }, models: { 'fake-text': 'fake-model' } },
        image: { provider: 'fake-image', apiKeys: { 'fake-image': 'image-key' }, models: { 'fake-image': 'fake-model' } },
        outputFolder,
      },
    });

    assert.equal(content.cards.length, 3);
    assert.ok(fs.existsSync(path.join(content.workDir, 'caption.txt')));
    assert.ok(fs.existsSync(path.join(content.workDir, 'post.json')));
    assert.ok(fs.statSync(content.cards[0].path).size > 1000);
    assert.match(fs.readFileSync(path.join(content.workDir, 'caption.txt'), 'utf8'), /#비타민B12/);
    assert.deepEqual(instagramPublisher._test.readPngDimensions(content.cards[0].path), {
      width: 1080,
      height: 1350,
    });
    const publishable = instagramPublisher._test.validateCarouselContent({
      images: content.cards.map((card) => card.path),
      caption: content.captionText,
    });
    assert.equal(publishable.images.length, 3);
    assert.equal(
      creatorIpc._test.validateInstagramCardPaths(content.cards, outputFolder).length,
      3
    );
  } finally {
    textProviders.get = originalTextGet;
    imageProviders.get = originalImageGet;
    fs.rmSync(outputFolder, { recursive: true, force: true });
  }
});

test('가짜 AI 응답으로 쇼츠 WebM, 대본과 CapCut 자막을 실제로 만든다', { concurrency: false }, async () => {
  const outputFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'autom-youtube-test-'));
  const originalTextGet = textProviders.get;
  const originalImageGet = imageProviders.get;
  const progress = [];
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JxS8AAAAASUVORK5CYII=',
    'base64'
  );

  try {
    textProviders.get = () => ({
      generateYoutubeProject: async () =>
        youtubeSchema.parseYoutubeProjectResponse(buildValidYoutubeResponse(4), {
          format: 'shorts',
          durationSeconds: 30,
          sceneCount: 4,
          contentStyle: 'educational',
        }),
    });
    imageProviders.get = () => ({
      generateImage: async ({ outputPath }) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, onePixelPng);
        return outputPath;
      },
    });

    const content = await youtubePipeline.generateYoutubeProject({
      keyword: '아침 피로 생활 습관',
      format: 'shorts',
      durationSeconds: 30,
      sceneCount: 4,
      contentStyle: 'educational',
      channelTheme: '직장인의 현실적인 건강 습관',
      targetAudience: '건강 습관을 만들고 싶은 직장인',
      creatorPerspective: '일주일 단위로 생활 기록을 직접 확인합니다.',
      recentProjects: [{ keyword: '퇴근 후 걷기', title: '퇴근 후 걷기 기록', originalAngle: '걷는 시간 비교' }],
      settings: {
        text: { provider: 'fake-text', apiKeys: { 'fake-text': 'text-key' }, models: { 'fake-text': 'fake-model' } },
        image: { provider: 'fake-image', apiKeys: { 'fake-image': 'image-key' }, models: { 'fake-image': 'fake-model' } },
        outputFolder,
      },
      onProgress: (value) => progress.push(value),
    });

    assert.equal(content.format, 'shorts');
    assert.equal(content.resolution, '1080x1920');
    assert.equal(content.scenes.length, 4);
    assert.ok(fs.statSync(content.videoPath).size > 2048);
    assert.ok(fs.existsSync(content.scriptPath));
    assert.ok(fs.existsSync(content.srtPath));
    assert.ok(fs.existsSync(content.thumbnailPath));
    assert.ok(fs.existsSync(content.channelReviewPath));
    assert.match(fs.readFileSync(content.srtPath, 'utf8'), /00:00:30,000/);
    assert.match(fs.readFileSync(content.metadataPath, 'utf8'), /일부 시각 자료는 AI로 제작되었습니다/);
    assert.match(fs.readFileSync(content.channelReviewPath, 'utf8'), /인기·시청 시간 상위 영상/);
    assert.equal(content.authenticityReport.comparedRecentCount, 1);
    assert.equal(progress.some((item) => item.stage === 'illustrating' && item.current === 4), true);
    assert.equal(progress.some((item) => item.stage === 'encoding' && item.current === 1), true);

    const inspection = spawnSync(youtubePipeline._test.getFfmpegExecutablePath(), ['-hide_banner', '-i', content.videoPath], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.match(inspection.stderr, /Duration: 00:00:30\.00/);
    assert.match(inspection.stderr, /1080x1920/);
    assert.match(inspection.stderr, /24 fps/);
  } finally {
    textProviders.get = originalTextGet;
    imageProviders.get = originalImageGet;
    fs.rmSync(outputFolder, { recursive: true, force: true });
  }
});

test('인스타그램 로그인 쿠키가 있을 때만 연결 상태로 판단한다', async () => {
  assert.equal(
    await instagramSession.isLoggedIn({ cookies: async () => [{ name: 'sessionid', value: 'saved-session' }] }),
    true
  );
  assert.equal(
    await instagramSession.isLoggedIn({ cookies: async () => [{ name: 'csrftoken', value: 'token' }] }),
    false
  );
});

test('인스타그램 게시물 주소와 출력 폴더 밖 파일은 안전 검사에서 구분한다', () => {
  assert.equal(creatorIpc._test.isPathInside('C:\\output', 'C:\\output\\instagram\\card_1.png'), true);
  assert.equal(creatorIpc._test.isPathInside('C:\\output', 'C:\\outside\\card_1.png'), false);
});

test('선택 공급자에 키가 없어도 저장된 텍스트 키가 하나면 그 공급자를 자동 선택한다', () => {
  const resolved = resolveConfiguredProvider(
    {
      text: {
        provider: 'anthropic',
        apiKeys: { anthropic: '', openai: 'saved-key', gemini: '' },
        models: { openai: 'gpt-test' },
      },
    },
    'text',
    {
      list: () => [
        { id: 'anthropic', label: 'Anthropic' },
        { id: 'openai', label: 'OpenAI' },
        { id: 'gemini', label: 'Gemini' },
      ],
    }
  );

  assert.equal(resolved.providerId, 'openai');
  assert.equal(resolved.apiKey, 'saved-key');
  assert.equal(resolved.autoSelected, true);
});

test('여러 API 키가 저장돼 있으면 사용자가 드롭다운에서 고른 공급자를 그대로 사용한다', () => {
  const registry = {
    list: () => [
      { id: 'anthropic', label: 'Anthropic' },
      { id: 'openai', label: 'OpenAI' },
      { id: 'gemini', label: 'Gemini' },
    ],
  };
  const settings = {
    text: {
      provider: 'gemini',
      apiKeys: { anthropic: 'anthropic-key', openai: 'openai-key', gemini: 'gemini-key' },
      models: { anthropic: 'claude-test', openai: 'gpt-test', gemini: 'gemini-test' },
    },
  };

  const resolved = resolveConfiguredProvider(settings, 'text', registry);
  assert.equal(resolved.providerId, 'gemini');
  assert.equal(resolved.apiKey, 'gemini-key');
  assert.equal(resolved.model, 'gemini-test');
  assert.equal(resolved.autoSelected, false);
});

test('인스타그램 화면에는 블로그와 같은 키워드 자동추천 연결이 있다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'creator', 'views', 'instagram.js'), 'utf8');
  assert.match(source, /id="btn-recommend-instagram-keyword"/);
  assert.match(source, /window\.api\.recommendKeyword\(\)/);
});

test('Creator 유튜브 탭은 쇼츠·롱폼 선택, 키워드 추천과 영상 생성을 연결한다', () => {
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'creator', 'index.html'), 'utf8');
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'creator', 'renderer.js'), 'utf8');
  const youtubeSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'views', 'youtube.js'),
    'utf8'
  );
  const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'apps', 'creator', 'preload.js'), 'utf8');

  assert.match(indexSource, /data-tab="youtube"/);
  assert.match(rendererSource, /initYoutubeView/);
  assert.match(youtubeSource, /value="shorts"/);
  assert.match(youtubeSource, /value="longform"/);
  assert.match(youtubeSource, /window\.api\.recommendKeyword\(\)/);
  assert.match(youtubeSource, /window\.api\.generateYoutubeProject/);
  assert.match(youtubeSource, /id="btn-open-capcut"/);
  assert.match(youtubeSource, /window\.api\.openCapcutEditor\(\)/);
  assert.match(youtubeSource, /id="btn-open-youtube-upload"/);
  assert.match(youtubeSource, /window\.api\.openYoutubeUploadPage\(\)/);
  assert.match(youtubeSource, /id="youtube-channel-theme"/);
  assert.match(youtubeSource, /id="youtube-target-audience"/);
  assert.match(youtubeSource, /수익화 정책 검토/);
  assert.match(preloadSource, /youtube:generate-project/);
  assert.match(preloadSource, /youtube:progress/);
  assert.match(preloadSource, /youtube:open-capcut/);
  assert.match(preloadSource, /youtube:open-upload-page/);
  assert.equal(creatorIpc._test.CAPCUT_EDITOR_URL, 'https://www.capcut.com/tools/online-video-editor');
  assert.equal(creatorIpc._test.YOUTUBE_UPLOAD_URL, 'https://www.youtube.com/upload');
});

test('설치 준비 단계는 Chromium과 YouTube 영상용 FFmpeg를 함께 포함한다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-chromium.js'), 'utf8');
  assert.match(source, /browser\.name === 'ffmpeg'/);
  assert.match(source, /ffmpeg-win64\.exe/);
  assert.ok(fs.existsSync(youtubePipeline._test.getFfmpegExecutablePath()));
});

test('인스타그램 만들기 메뉴가 늦게 나타나도 다시 찾아 클릭한다', async () => {
  let visibilityChecks = 0;
  let clicked = false;
  const item = {
    isVisible: async () => {
      visibilityChecks += 1;
      return visibilityChecks >= 2;
    },
    click: async () => {
      clicked = true;
    },
  };
  const locator = {
    count: async () => 1,
    nth: () => item,
  };

  const result = await instagramPublisher._test.clickFirstVisible([locator], null, { timeoutMs: 1000 });
  assert.equal(result, true);
  assert.equal(clicked, true);
  assert.ok(visibilityChecks >= 2);
});

test('인스타그램 축소 메뉴의 새로운 게시물 아이콘도 발행 대상으로 찾는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'backend', 'features', 'instagram', 'publisher.js'), 'utf8');
  assert.match(source, /aria-label="새로운 게시물"/);
  assert.match(source, /timeoutMs: 10000/);
});

test('계정명이 포함된 인스타그램 게시물 링크를 표준 주소로 바꾼다', async () => {
  const post = {
    waitFor: async () => {},
    getAttribute: async () => '/hyuns_j0/p/Da1Ysj_E06w/',
  };
  const page = {
    goto: async () => {},
    locator: () => ({ first: () => post }),
  };

  const url = await instagramPublisher._test.findLatestPostUrl(page, 'hyuns_j0');
  assert.equal(url, 'https://www.instagram.com/p/Da1Ysj_E06w/');
});

test('Creator 발행 기록은 블로그·인스타그램·유튜브 탭을 사용한다', () => {
  const historySource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'blog', 'views', 'history.js'), 'utf8');
  const creatorHistorySource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'views', 'history.js'),
    'utf8'
  );
  assert.match(historySource, /\{ id: 'blog', label: '블로그' \}/);
  assert.match(historySource, /\{ id: 'instagram', label: '인스타그램' \}/);
  assert.match(historySource, /\{ id: 'youtube', label: '유튜브' \}/);
  assert.match(historySource, /if \(platform === 'instagram'\) return 'instagram'/);
  assert.match(historySource, /return 'blog'/);
  assert.match(creatorHistorySource, /platformTabs: true/);
});

test('API 키 발급 버튼은 등록된 공급자의 공식 페이지만 연결한다', () => {
  assert.equal(getApiKeyPageUrl('openai'), 'https://platform.openai.com/api-keys');
  assert.equal(getApiKeyPageUrl('anthropic'), 'https://platform.claude.com/settings/keys');
  assert.equal(getApiKeyPageUrl('gemini'), 'https://aistudio.google.com/app/apikey');
  assert.throws(() => getApiKeyPageUrl('https://example.com'), /지원하지 않는/);

  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'blog', 'views', 'settings.js'), 'utf8');
  assert.match(settingsSource, /class="btn-open-api-key-page secondary"/);
  assert.match(settingsSource, /window\.api\.openApiKeyPage\(card\.dataset\.provider\)/);
});

test('Creator 메뉴는 항목별 아이콘을 구분하고 탭 전환 시 화면 상단으로 이동한다', () => {
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'renderer.js'),
    'utf8'
  );
  const stylesSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'shared', 'styles', 'app.css'),
    'utf8'
  );

  for (const tabId of ['dashboard', 'blog', 'instagram', 'youtube', 'history', 'settings']) {
    assert.match(stylesSource, new RegExp(`data-tab="${tabId}"`));
  }
  assert.match(rendererSource, /pageScroller\.scrollTop = 0/);
  assert.match(rendererSource, /pageScroller\.scrollLeft = 0/);
});

test('AutoM과 Creator는 같은 공통 디자인 계층을 사용한다', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  const blogIndexSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'blog', 'index.html'),
    'utf8'
  );
  const creatorIndexSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'index.html'),
    'utf8'
  );
  const blogRendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'blog', 'renderer.js'),
    'utf8'
  );
  const sharedStylesSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'shared', 'styles', 'app.css'),
    'utf8'
  );

  assert.match(blogIndexSource, /\.\.\/shared\/styles\/app\.css/);
  assert.match(creatorIndexSource, /\.\.\/shared\/styles\/app\.css/);
  assert.match(blogIndexSource, /class="creator-app autom-blog-app"/);
  for (const tabId of ['main', 'history', 'settings']) {
    assert.match(blogIndexSource, new RegExp(`data-tab="${tabId}"`));
  }
  assert.match(blogRendererSource, /initStyledBlogView/);
  assert.match(blogRendererSource, /initStyledHistoryView/);
  assert.match(blogRendererSource, /initStyledSettingsView/);
  assert.match(sharedStylesSource, /data-tab="main"/);
  assert.ok(packageJson.build.files.includes('frontend/shared/**/*'));
});

test('사용자에게 표시되는 앱 이름과 설치 파일 이름에는 버전을 붙이지 않는다', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  const creatorBuild = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'electron-builder.creator.json'), 'utf8')
  );
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'apps', 'blog', 'index.js'), 'utf8');
  const creatorMainSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'apps', 'creator', 'index.js'),
    'utf8'
  );
  const creatorIndexSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'index.html'),
    'utf8'
  );

  assert.equal(packageJson.build.productName, 'AutoM');
  assert.equal(packageJson.build.artifactName, 'AutoM Setup.${ext}');
  assert.equal(creatorBuild.productName, 'AutoM Creator');
  assert.equal(creatorBuild.artifactName, 'AutoM Creator Setup.${ext}');
  assert.match(mainSource, /app\.setName\('AutoM'\)/);
  assert.match(creatorMainSource, /app\.setName\('AutoM Creator'\)/);
  assert.doesNotMatch(creatorIndexSource, /AutoM Creator \d/);
});

test('Creator 첫 화면은 참고 구조의 실제 대시보드로 시작한다', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'index.html'),
    'utf8'
  );
  const rendererSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'renderer.js'),
    'utf8'
  );
  const dashboardSource = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'creator', 'views', 'dashboard.js'),
    'utf8'
  );

  assert.match(indexSource, /class="tab-button active" data-tab="dashboard"/);
  assert.match(indexSource, /id="tab-dashboard" class="tab-panel active"/);
  assert.match(rendererSource, /activateTab\('dashboard'\)/);
  assert.match(dashboardSource, /creator-dashboard-record-grid/);
  assert.match(dashboardSource, /creator-dashboard-workflow-steps/);
  assert.match(dashboardSource, /creator-dashboard-connections/);
  assert.match(dashboardSource, /creator-dashboard-activity-section/);
  assert.match(dashboardSource, /creator-dashboard-notice-section/);
});
