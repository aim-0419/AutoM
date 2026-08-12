/**
 * [Creator 기록 화면]
 *
 * 블로그·인스타그램·유튜브 작업이 모두 하나의 기록 파일(history.json)에 쌓입니다.
 * Creator는 그것을 플랫폼별 탭으로 나눠 보여줍니다(platformTabs: true).
 * 블로그 전용 앱은 탭 없이 블로그 기록만 표시합니다.
 */
import { initStyledHistoryView } from '../../shared/views/history.js';

// Creator에서는 하나의 기록 파일을 플랫폼별 탭으로 나눠 보여 준다.
export async function initCreatorHistoryView(container) {
  await initStyledHistoryView(container, { platformTabs: true });
}
