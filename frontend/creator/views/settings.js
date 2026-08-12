/**
 * [Creator 설정 화면]
 *
 * 설정 화면의 실제 내용은 두 앱이 공유합니다(shared/views/settings.js).
 * 다른 점은 하나뿐입니다: Creator는 인스타그램 기능이 있으므로 인스타그램 로그인 항목을
 * 함께 보여주고, 블로그 전용 앱(AutoM)은 그 항목을 감춥니다.
 */
import { initStyledSettingsView } from '../../shared/views/settings.js';

// Creator 설정에는 블로그와 함께 인스타그램 로그인 관리 항목도 표시한다.
export async function initCreatorSettingsView(container) {
  await initStyledSettingsView(container, { includeInstagram: true });
}
