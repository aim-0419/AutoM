/**
 * [실제로 사용할 AI를 결정하는 함수]
 *
 * 비개발자를 위한 설명:
 * - 사용자가 설정에서 "Claude를 쓰겠다"고 골랐어도, 정작 Claude API 키를 입력하지 않았다면
 *   글을 만들 수 없습니다. 이런 상황을 자동으로 바로잡아 주는 것이 이 함수입니다.
 *
 * 판단 순서:
 *   1) 고른 AI에 키가 있으면 → 그대로 사용
 *   2) 고른 AI에 키가 없는데, 저장된 키가 다른 회사 것 딱 하나뿐이면 → 그 회사로 자동 전환
 *      (사용자가 키를 넣은 회사를 쓰려던 것으로 보는 게 자연스럽기 때문)
 *   3) 키가 하나도 없거나 여러 개라 판단이 애매하면 → "설정에서 키를 확인해 주세요" 오류
 *
 * 반환값의 autoSelected가 true면 2번처럼 자동 전환이 일어났다는 뜻이고,
 * 이 경우 호출한 쪽에서 설정 파일도 실제로 바꿔 저장한다.
 */
function resolveConfiguredProvider(settings, kind, registry) {
  const providerSettings = settings?.[kind] || {};
  const selectedProviderId = providerSettings.provider;
  const selectedApiKey = providerSettings.apiKeys?.[selectedProviderId];

  if (selectedProviderId && selectedApiKey) {
    return {
      providerId: selectedProviderId,
      apiKey: selectedApiKey,
      model: providerSettings.models?.[selectedProviderId],
      autoSelected: false,
    };
  }

  const configuredProviders = registry
    .list()
    .map((provider) => provider.id)
    .filter((providerId) => Boolean(providerSettings.apiKeys?.[providerId]));

  if (configuredProviders.length === 1) {
    const providerId = configuredProviders[0];
    return {
      providerId,
      apiKey: providerSettings.apiKeys[providerId],
      model: providerSettings.models?.[providerId],
      autoSelected: providerId !== selectedProviderId,
    };
  }

  const kindLabel = kind === 'image' ? '이미지' : '텍스트';
  const selectedProvider = registry.list().find((provider) => provider.id === selectedProviderId);
  const selectedLabel = selectedProvider?.label || selectedProviderId || '선택 안 됨';
  throw new Error(
    `${kindLabel} AI(${selectedLabel}) API 키가 설정되지 않았습니다. 설정에서 사용할 공급자와 저장된 키를 확인해 주세요.`
  );
}

module.exports = { resolveConfiguredProvider };
