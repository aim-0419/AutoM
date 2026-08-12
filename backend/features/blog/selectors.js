/**
 * [네이버 글쓰기 화면의 '버튼 주소록']
 *
 * 비개발자를 위한 설명:
 * - 프로그램이 사람 대신 네이버 글쓰기 화면을 조작하려면, "제목 칸이 어디 있는지",
 *   "발행 버튼이 어디 있는지"를 알아야 합니다.
 * - 웹페이지의 각 요소에는 이름표(클래스, id)가 붙어 있는데, 그 이름표를 찾는 방법을
 *   '셀렉터(selector)'라고 합니다. 이 파일은 그 셀렉터들을 한 곳에 모은 주소록입니다.
 *
 * ⚠ 가장 중요한 주의사항:
 * - 네이버가 화면을 개편하면 이름표가 바뀌어 자동 발행이 실패할 수 있습니다.
 *   그럴 때는 코드 전체가 아니라 이 파일 하나만 고치면 됩니다. 그래서 따로 분리했습니다.
 * - 이름표에는 publish_btn__m9KHH 처럼 뒤에 무작위 글자가 붙습니다(재배포마다 바뀜).
 *   그래서 앞부분만 부분 일치로 찾도록(`[class*="publish_btn__"]`) 만들어 두어,
 *   웬만한 변경에는 견딜 수 있게 했습니다.
 *
 * 확인 날짜: 2026-07-08 (실제 로그인 후 blog.naver.com 글쓰기 페이지에서 직접 확인)
 */

module.exports = {
  writeUrl: (blogId) => `https://blog.naver.com/${blogId}?Redirect=Write&`,

  // 에디터 본체는 이 URL 조각을 포함한 iframe 안에 있다.
  editorFrameUrlPart: 'PostWriteForm',

  // "작성 중인 글이 있습니다 / 이어서 작성하시겠습니까?" 팝업 - [취소]를 눌러 새 글로 시작한다.
  continueWritingPopup: '.se-popup-alert-confirm',
  continueWritingCancelButton: '.se-popup-button-cancel',

  // 제목 / 본문
  titleArea: '.se-title-text',
  bodyComponent: '.se-component.se-text',

  // 이미지 업로드 (에디터 상단 툴바의 "사진" 버튼)
  imageToolbarButton: '.se-toolbar-item-image [data-name="image"]',

  // 발행 버튼 (우측 상단, 발행 설정 패널을 여는 버튼)
  openPublishPanelButton: '[class*="publish_btn__"]',

  // 발행 설정 패널 내부
  categorySelectButton: '[class*="option_category"] button[class*="selectbox_button"]',
  categoryOptionByName: (name) => `[role="menuitem"]:has-text("${name}"), li:has-text("${name}")`,

  // 실제 input은 opacity:0으로 숨겨져 있어 감싸는 span을 클릭해야 동작한다.
  visibilityRadio: {
    public: 'span:has(#open_public)',
    neighbor: 'span:has(#open_neighbor)',
    bothNeighbor: 'span:has(#open_both_neighbor)',
    private: 'span:has(#open_private)',
  },

  // 발행 시간: 현재 발행 또는 네이버 서버에 예약 등록
  publishTimeRadio: {
    now: 'label[for="radio_time1"]',
    scheduled: 'label[for="radio_time2"]',
  },
  scheduledTimeInput: 'input#radio_time2',
  scheduleDateInput: 'input[class*="input_date"]',
  scheduleHourSelect: 'select[class*="hour_option"]',
  scheduleMinuteSelect: 'select[class*="minute_option"]',
  scheduleCalendar: '.ui-datepicker:visible',
  scheduleCalendarYear: '.ui-datepicker-year',
  scheduleCalendarMonth: '.ui-datepicker-month',
  scheduleCalendarNext: '.ui-datepicker-next:not(.ui-state-disabled)',
  scheduleCalendarDayButtons: 'tbody button.ui-state-default',

  // 같은 영역에 크기가 0인 "fake_input" 요소가 함께 있으므로 반드시 tag_input으로 특정한다.
  tagInput: 'input[class*="tag_input"]',

  // 최종 발행 확정 버튼 (패널 내부 - openPublishPanelButton과는 다른 버튼)
  confirmPublishButton: '[class*="layer_publish"] button[class*="confirm_btn"]',
};
