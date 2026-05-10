export interface ResolveVoiceCallerIdInput {
  receiverId: string;
  countryCode: string;
}

export interface VoiceCallerIdRepository {
  resolveForReceiver(input: ResolveVoiceCallerIdInput): Promise<string | undefined>;
}
