import { useEffect, useMemo, useState } from 'react';
import type { CharacterConfig, Conversation, Message, VoiceConfig } from '../../services/interfaces';
import type { AssetRecord, CharacterPresentationProfile } from '../../services/phase2/types';
import { resolveCallViewMode, selectDynamicAvatarSource, selectExpressionAsset } from '../../services/phase3/presentation';
import type { VoiceRuntime } from '../../services/phase3/voice';
import { useCallStore } from '../../stores/call';
import { CallMiniWindow } from './CallMiniWindow';
import { CallWindow } from './CallWindow';

interface CallLayerProps {
  characters: CharacterConfig[];
  conversations: Conversation[];
  avatarDataUrls: Record<string, string>;
  expressionAssets: AssetRecord[];
  expressionAssetDataUrls: Record<string, string>;
  dynamicAssets?: AssetRecord[];
  dynamicAssetDataUrls?: Record<string, string>;
  presentationProfiles: Record<string, CharacterPresentationProfile>;
  voiceRuntime?: VoiceRuntime;
  voiceConfig?: VoiceConfig;
  isLoading: boolean;
  onSend: (content: string) => void;
  onRestoreCharacter: (characterId: string) => void;
}

function latestAssistantMessage(conversation: Conversation | undefined): Message | undefined {
  const messages = conversation?.messages ?? [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'assistant' && message.content.trim()) {
      return message;
    }
  }

  return undefined;
}

function latestUserMessage(conversation: Conversation | undefined): Message | undefined {
  const messages = conversation?.messages ?? [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'user' && message.content.trim()) {
      return message;
    }
  }

  return undefined;
}

function formatElapsed(startedAt: string, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
  const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function CallLayer({
  characters,
  conversations,
  avatarDataUrls,
  expressionAssets,
  expressionAssetDataUrls,
  dynamicAssets = [],
  dynamicAssetDataUrls = {},
  presentationProfiles,
  voiceRuntime,
  voiceConfig,
  isLoading,
  onSend,
  onRestoreCharacter,
}: CallLayerProps) {
  const session = useCallStore(state => state.session);
  const minimizeCall = useCallStore(state => state.minimizeCall);
  const restoreCall = useCallStore(state => state.restoreCall);
  const endCall = useCallStore(state => state.endCall);
  const setLastSubtitleMessageId = useCallStore(state => state.setLastSubtitleMessageId);
  const character = characters.find(item => item.id === session?.characterId);
  const conversation = conversations.find(item => item.id === session?.timelineId || item.characterId === session?.characterId);
  const assistantMessage = latestAssistantMessage(conversation);
  const userMessage = latestUserMessage(conversation);
  const [now, setNow] = useState(() => Date.now());
  const characterExpressionAssets = useMemo(
    () => expressionAssets.filter(asset => asset.characterId === session?.characterId),
    [expressionAssets, session?.characterId],
  );
  const characterDynamicAssets = useMemo(
    () => dynamicAssets.filter(asset => asset.characterId === session?.characterId),
    [dynamicAssets, session?.characterId],
  );
  const profile = session?.characterId ? presentationProfiles[session.characterId] : undefined;
  const expressionAsset = selectExpressionAsset({
    emotion: assistantMessage?.emotion,
    assets: characterExpressionAssets,
    profile,
  });
  const dynamicSource = selectDynamicAvatarSource({
    assets: characterDynamicAssets,
    assetDataUrls: dynamicAssetDataUrls,
    profile,
  });
  const displayName = conversation?.contactRemark?.trim() || character?.name || '联系人';
  const imageSrc = expressionAsset
    ? expressionAssetDataUrls[expressionAsset.id] || (character?.avatarAssetId ? avatarDataUrls[character.avatarAssetId] : undefined)
    : character?.avatarAssetId
      ? avatarDataUrls[character.avatarAssetId]
      : undefined;

  useEffect(() => {
    if (session && assistantMessage?.id && assistantMessage.id !== session.lastSubtitleMessageId) {
      setLastSubtitleMessageId(assistantMessage.id);
    }
  }, [assistantMessage?.id, session, setLastSubtitleMessageId]);

  useEffect(() => {
    if (!session) {
      return undefined;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [session?.startedAt]);

  if (!session || !character || !conversation) {
    return null;
  }

  const mode = resolveCallViewMode(session.mode);
  const subtitle = assistantMessage?.content;
  const userSubtitle = userMessage?.content;

  if (mode === 'mini') {
    return (
      <CallMiniWindow
        displayName={displayName}
        imageSrc={imageSrc}
        subtitle={subtitle}
        onRestore={() => {
          onRestoreCharacter(session.characterId);
          restoreCall();
        }}
        onClose={endCall}
      />
    );
  }

  return (
    <CallWindow
      displayName={displayName}
      statusLabel={isLoading ? '正在输入' : '通话中'}
      elapsedLabel={formatElapsed(session.startedAt, now)}
      imageSrc={imageSrc}
      dynamicSource={dynamicSource}
      voiceRuntime={voiceRuntime}
      voiceConfig={voiceConfig}
      subtitle={subtitle}
      latestUserMessage={userSubtitle}
      emotion={assistantMessage?.emotion}
      voiceInstruct={assistantMessage?.voiceInstruct}
      isLoading={isLoading}
      onSend={onSend}
      onMinimize={minimizeCall}
      onClose={endCall}
    />
  );
}
