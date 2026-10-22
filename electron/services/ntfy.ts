export interface NtfyConfig {
  url: string;
  topic: string;
  token?: string;
  click?: string;
}

export interface NtfySong {
  title: string;
  creator?: string;
  shareLine: string;
}

export function ntfyConfigFromEnv(): NtfyConfig | null {
  const url = process.env.HEREIN_NTFY_URL?.trim();
  const topic = process.env.HEREIN_NTFY_TOPIC?.trim();

  if (!url || !topic) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ''),
    topic,
    token: process.env.HEREIN_NTFY_TOKEN?.trim() || undefined,
    click: process.env.HEREIN_NTFY_CLICK?.trim() || undefined,
  };
}

export async function publishNtfy(
  config: NtfyConfig,
  song: NtfySong,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const creator = song.creator ? ` — ${song.creator}` : '';
  const response = await fetchImpl(`${config.url}/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify({
      topic: config.topic,
      title: '蓝蓝转了一首歌',
      message: `${song.title}${creator}\n${song.shareLine}`,
      tags: ['musical_note'],
      ...(config.click ? { click: config.click } : {}),
    }),
  });

  return response.ok;
}
