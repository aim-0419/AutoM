/**
 * 선택된 AI 공급자와 저장된 API 키가 실제로 함께 사용할 수 있는지 확인한다.
 * 선택 공급자에 키가 없고 저장된 키가 딱 하나뿐이면, 사용자가 입력한 그 공급자를 자동으로 사용한다.
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
