/**
 * 주제를 바탕으로 인스타그램 카드 문구와 이미지를 생성하고 로컬 결과물을 만든다.
 * 실제 인스타그램 게시 작업은 publisher.js가 별도로 담당한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const textProviders = require('../../core/providers/text');
const imageProviders = require('../../core/providers/image');
const { resolveConfiguredProvider } = require('../../core/providers/configuredProvider');
const { buildSafeImagePrompt } = require('../../core/pipeline');
const { mapWithConcurrency } = require('../../core/concurrency');
const { MIN_CARD_COUNT, MAX_CARD_COUNT, normalizeCardCount } = require('../../core/providers/text/instagramSchema');

const IMAGE_GENERATION_CONCURRENCY = 2;

function validateKeyword(keyword) {
  const value = String(keyword || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!value || [...value].length > 100) {
    throw new Error('주제는 1~100자로 입력해 주세요.');
  }
  return value;
}

function validateCardCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < MIN_CARD_COUNT || count > MAX_CARD_COUNT) {
    throw new Error(`카드 수는 ${MIN_CARD_COUNT}~${MAX_CARD_COUNT}개로 선택해 주세요.`);
  }
  return normalizeCardCount(count);
}

function createJobFolderName(keyword) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeKeyword = keyword
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return `${timestamp}_${safeKeyword || 'instagram'}`;
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
  return `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

function renderCardHtml({ title, card, cardIndex, cardCount, backgroundDataUri }) {
  const displayTitle = cardIndex === 1 ? title : card.headline;
  const eyebrow = cardIndex === 1 ? 'SAVE THIS' : `POINT ${String(cardIndex).padStart(2, '0')}`;
  const footer = `${String(cardIndex).padStart(2, '0')} / ${String(cardCount).padStart(2, '0')}`;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 1080px; height: 1350px; margin: 0; }
      body { color: #ffffff; font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif; }
      .card { position: relative; isolation: isolate; width: 1080px; height: 1350px; overflow: hidden; background: #20242b; }
      .background { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .card::before { content: ""; position: absolute; z-index: 1; inset: 0; background: rgba(6, 10, 16, 0.60); }
      .content { position: relative; z-index: 2; display: flex; flex-direction: column; height: 100%; padding: 92px 84px 72px; }
      .eyebrow { align-self: flex-start; border: 2px solid rgba(255,255,255,0.95); background: rgba(0,0,0,0.32); padding: 10px 15px; font-size: 24px; font-weight: 700; letter-spacing: 1px; text-shadow: 0 2px 6px rgba(0,0,0,0.9); }
      .copy { margin-top: auto; max-width: 860px; }
      h1 { margin: 0 0 34px; font-size: 76px; line-height: 1.17; letter-spacing: 0; word-break: keep-all; overflow-wrap: break-word; text-shadow: 0 3px 12px rgba(0,0,0,0.96); }
      p { margin: 0; font-size: 35px; line-height: 1.55; font-weight: 500; word-break: keep-all; overflow-wrap: break-word; text-shadow: 0 2px 9px rgba(0,0,0,0.96); }
      .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 58px; padding-top: 24px; border-top: 2px solid rgba(255,255,255,0.68); font-size: 25px; font-weight: 700; letter-spacing: 1px; }
      .footer-mark { color: #ff765f; }
    </style>
  </head>
  <body>
    <article class="card">
      <img class="background" src="${backgroundDataUri}" alt="" />
      <div class="content">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        <div class="copy">
          <h1>${escapeHtml(displayTitle)}</h1>
          <p>${escapeHtml(card.body)}</p>
          <div class="footer"><span class="footer-mark">AUTOM CREATOR</span><span>${escapeHtml(footer)}</span></div>
        </div>
      </div>
    </article>
  </body>
</html>`;
}

function buildBackgroundPrompt(card) {
  return buildSafeImagePrompt(
    `Portrait editorial photograph for an educational Instagram carousel slide. ${card.imagePrompt}. ` +
      'Use a calm, high-quality composition with visual breathing room for a text overlay. ' +
      'No readable text, numbers, logo, brand name, packaging label, watermark, collage, or before-and-after layout.'
  );
}

async function renderCards(cards, title, workDir, onProgress) {
  // 설치본에는 로그인 창과 카드 합성에 함께 쓰는 일반 Chromium이 들어 있다.
  // 실행 파일을 직접 지정하면 Playwright가 별도의 headless shell을 찾지 않아
  // 새 컴퓨터에서도 브라우저를 추가로 설치하지 않고 카드를 만들 수 있다.
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    const renderedCards = [];
    for (const card of cards) {
      const outputPath = path.join(workDir, `card_${card.index}.png`);
      await page.setContent(
        renderCardHtml({
          title,
          card,
          cardIndex: card.index,
          cardCount: cards.length,
          backgroundDataUri: toDataUri(card.backgroundPath),
        }),
        { waitUntil: 'load' }
      );
      await page.screenshot({ path: outputPath, type: 'png' });
      onProgress?.({ stage: 'rendering', current: card.index, total: cards.length });
      renderedCards.push({
        ...card,
        path: outputPath,
        fileUrl: pathToFileURL(outputPath).href,
      });
    }
    await page.close();
    return renderedCards;
  } finally {
    await browser.close();
  }
}

function writeBundle(workDir, content) {
  const captionText = `${content.caption}\n\n${content.callToAction}\n\n${content.tags.map((tag) => `#${tag}`).join(' ')}`;
  fs.writeFileSync(path.join(workDir, 'caption.txt'), captionText, 'utf8');
  fs.writeFileSync(
    path.join(workDir, 'post.json'),
    JSON.stringify(
      {
        keyword: content.keyword,
        title: content.title,
        caption: content.caption,
        callToAction: content.callToAction,
        tags: content.tags,
        cards: content.cards.map(({ index, headline, body, imagePrompt, path: imagePath }) => ({
          index,
          headline,
          body,
          imagePrompt,
          imagePath,
        })),
      },
      null,
      2
    ),
    'utf8'
  );
  return captionText;
}

async function generateCarousel({ keyword, cardCount, settings, onProgress }) {
  const normalizedKeyword = validateKeyword(keyword);
  const normalizedCardCount = validateCardCount(cardCount);
  const textConfig = resolveConfiguredProvider(settings, 'text', textProviders);
  const imageConfig = resolveConfiguredProvider(settings, 'image', imageProviders);
  const textProviderId = textConfig.providerId;
  const imageProviderId = imageConfig.providerId;
  const textApiKey = textConfig.apiKey;
  const imageApiKey = imageConfig.apiKey;

  const outputFolder = String(settings?.outputFolder || '').trim();
  if (!outputFolder) throw new Error('설정에서 저장 폴더를 먼저 선택해 주세요.');

  const workDir = path.join(outputFolder, 'instagram', createJobFolderName(normalizedKeyword));
  fs.mkdirSync(workDir, { recursive: true });

  const textProvider = textProviders.get(textProviderId);
  const imageProvider = imageProviders.get(imageProviderId);
  onProgress?.({ stage: 'writing', current: 0, total: normalizedCardCount });
  const draft = await textProvider.generateInstagramCarousel({
    keyword: normalizedKeyword,
    cardCount: normalizedCardCount,
    model: textConfig.model,
    apiKey: textApiKey,
  });

  let completedImageCount = 0;
  onProgress?.({ stage: 'illustrating', current: 0, total: draft.cards.length });
  const cardsWithBackgrounds = await mapWithConcurrency(
    draft.cards,
    IMAGE_GENERATION_CONCURRENCY,
    async (card, index) => {
      const cardIndex = index + 1;
      const backgroundPath = path.join(workDir, `background_${cardIndex}.png`);
      await imageProvider.generateImage({
        prompt: buildBackgroundPrompt(card),
        model: imageConfig.model,
        apiKey: imageApiKey,
        outputPath: backgroundPath,
      });
      completedImageCount += 1;
      onProgress?.({ stage: 'illustrating', current: completedImageCount, total: draft.cards.length });
      return { ...card, index: cardIndex, backgroundPath };
    }
  );

  const cards = await renderCards(cardsWithBackgrounds, draft.title, workDir, onProgress);
  const content = {
    keyword: normalizedKeyword,
    workDir,
    title: draft.title,
    caption: draft.caption,
    tags: draft.tags,
    callToAction: draft.callToAction,
    cards,
  };
  content.captionText = writeBundle(workDir, content);
  onProgress?.({ stage: 'done', current: cards.length, total: cards.length });
  return content;
}

module.exports = {
  generateCarousel,
  _test: {
    validateKeyword,
    validateCardCount,
    renderCardHtml,
    createJobFolderName,
    mapWithConcurrency,
    IMAGE_GENERATION_CONCURRENCY,
  },
};
