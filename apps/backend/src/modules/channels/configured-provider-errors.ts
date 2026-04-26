export class ChannelProviderConfigurationError extends Error {
  constructor(providerName: string) {
    super(`${providerName} provider credentials are not configured`);
  }
}
