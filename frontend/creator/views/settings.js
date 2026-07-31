import { initStyledSettingsView } from '../../shared/views/settings.js';

// Creator 설정에는 블로그와 함께 인스타그램 로그인 관리 항목도 표시한다.
export async function initCreatorSettingsView(container) {
  await initStyledSettingsView(container, { includeInstagram: true });
}
