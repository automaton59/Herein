export interface ParsedAssistantMessage {
  text: string;
  emotion?: string;
  voiceInstruct?: string;
}

const EMOTIONS = 'neutral|happy|sad|angry|shy|excited|worried|playful|serious';

export function parseAssistantMetadata(content: string): ParsedAssistantMessage {
  const emotionRegex = new RegExp(`\\[(?:emotion:\\s*)?(${EMOTIONS})\\]`, 'i');
  const stripEmotionRegex = new RegExp(`\\s*\\[(?:emotion:\\s*)?(${EMOTIONS})\\]\\s*`, 'gi');
  const trailingBareEmotionRegex = new RegExp(`(?:^|\\n)\\s*['"]?(${EMOTIONS})['"]?\\s*$`, 'i');
  const voiceInstructRegex = /\s*\[(?:voice|instruct|voice[_ -]?instruct)\s*:\s*([^\]\r\n]+)\]\s*/gi;
  let voiceInstruct: string | undefined;
  const withoutVoice = content.replace(voiceInstructRegex, (_match, value) => {
    if (!voiceInstruct && typeof value === 'string' && value.trim()) {
      voiceInstruct = value.trim();
    }

    return ' ';
  });
  const match = withoutVoice.match(emotionRegex) ?? withoutVoice.match(trailingBareEmotionRegex);

  if (match) {
    return {
      text: withoutVoice.replace(stripEmotionRegex, ' ').replace(trailingBareEmotionRegex, '').trim(),
      emotion: match[1].toLowerCase(),
      voiceInstruct,
    };
  }

  return {
    text: withoutVoice.trim(),
    voiceInstruct,
  };
}

export function stripAssistantMetadata(content: string) {
  return parseAssistantMetadata(content).text;
}
