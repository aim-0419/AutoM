/**
 * 실제 저장된 이미지 AI 설정으로 무문자 이미지 안전 조건을 확인한다.
 * 비용이 발생할 수 있으므로 --generate 옵션이 있을 때만 API를 호출한다.
 */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

if (!process.argv.includes('--generate')) {
  console.error('실제 이미지 생성에는 --generate 옵션이 필요합니다.');
  process.exit(1);
}

app.setPath('userData', path.join(app.getPath('appData'), 'marketing-app'));

const store = require('../backend/shared/store');
const imageProviders = require('../backend/core/providers/image');
const pipeline = require('../backend/core/pipeline');

app.whenReady().then(async () => {
  try {
    // 운영 앱과 같은 설정을 읽어, 실제로 선택된 이미지 AI와 모델을 시험한다.
    const settings = store.loadSettings();
    const providerId = settings.image.provider;
    const provider = imageProviders.get(providerId);
    const outputPath = path.join(process.cwd(), 'output', 'final-live-qa', '05-safe-image.png');
    // 공통 안전 문구를 붙인 프롬프트가 실제 이미지 요청에도 사용되는지 확인한다.
    const prompt = pipeline.buildSafeImagePrompt(
      'Two omega-3 supplement containers being compared on a bright wooden table, realistic natural light'
    );
    await provider.generateImage({
      prompt,
      model: settings.image.models[providerId],
      apiKey: settings.image.apiKeys[providerId],
      outputPath,
    });
    console.log(
      JSON.stringify({
        success: true,
        outputPath,
        bytes: fs.statSync(outputPath).size,
        visibilityAfterLiveTest: settings.publishDefaults.visibility,
        safeguardsIncluded:
          prompt.includes('Do not include any visible or readable text') &&
          prompt.includes('plain, unbranded, and label-free'),
      })
    );
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
