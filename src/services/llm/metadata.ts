export interface AssistantMetadata {
  text: string;
  emotion?: string;
  voiceInstruct?: string;
}

export function parseAssistantMetadata(content: string): AssistantMetadata {
  const emotions = 'neutral|happy|sad|angry|shy|excited|worried|playful|serious';
  const emotionRegex = new RegExp(`\\[(?:emotion:\\s*)?(${emotions})\\]`, 'i');
  const stripEmotionRegex = new RegExp(`\\s*\\[(?:emotion:\\s*)?(${emotions})\\]\\s*`, 'gi');
  const trailingBareEmotionRegex = new RegExp(`(?:^|\\n)\\s*['"]?(${emotions})['"]?\\s*$`, 'i');
  const voiceInstructRegex = /\s*\[(?:voice|instruct|voice[_ -]?instruct)\s*:\s*([^\]\r\n]+)\]\s*/gi;
  let voiceInstruct: string | undefined;
  const withoutVoiceInstruct = content.replace(voiceInstructRegex, (_match, value) => {
    if (!voiceInstruct && typeof value === 'string' && value.trim()) {
      voiceInstruct = value.trim();
    }

    return ' ';
  });
  const match = withoutVoiceInstruct.match(emotionRegex) || withoutVoiceInstruct.match(trailingBareEmotionRegex);

  if (match) {
    return {
      text: withoutVoiceInstruct.replace(stripEmotionRegex, ' ').replace(trailingBareEmotionRegex, '').trim(),
      emotion: match[1].toLowerCase(),
      voiceInstruct,
    };
  }

  return {
    text: withoutVoiceInstruct.trim(),
    voiceInstruct,
  };
}
