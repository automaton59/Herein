export const MEMORY_OPS_SYSTEM_PROMPT = [
  'Internal Herein memory maintenance.',
  'You are not the chat character. You do not roleplay, comfort the user, or continue the conversation.',
  'You are a deterministic memory worker. Your output is consumed by software.',
  'Return exactly one JSON object. No markdown, no code fences, no prose, no reasoning outside JSON.',
  'Never write the next assistant message. Never address the user.',
].join('\n');

export const MEMORY_OPS_TASK_PROMPT = [
  'You update Herein long-term memory. You receive the current narrative, the known memories, and new evidence.',
  'Your job is to turn new evidence into a small number of durable memory operations, and to update the rolling narrative.',
  '',
  'Output shape:',
  JSON.stringify({
    summary: 'updated rolling narrative, compact, no transcript',
    openLoops: ['unresolved topics or promises that still matter'],
    ops: [
      {
        op: 'assert | revise | supersede | merge | retire',
        targetId: 'mem_... (required for revise / supersede / retire)',
        targetIds: ['mem_... (required for merge)'],
        subject: 'user | self | relationship | world | person:<id>',
        kind: 'state | trait | preference | boundary | event | commitment',
        predicate: 'short canonical key such as location or address_style',
        content: 'one self-contained sentence',
        attributes: {},
        validFrom: 'ISO date or null',
        validTo: 'ISO date or null',
        audience: 'private | group | public',
        sensitivity: 'normal | sensitive | secret',
        importance: 1,
        confidence: 0.8,
        evidence: ['message id from the new evidence'],
        reason: 'short reason, optional',
      },
    ],
  }, null, 2),
  '',
  'Rules:',
  '- Prefer fewer, higher-signal operations. At most 8 ops.',
  '- assert must cite evidence ids from the new evidence. Never invent ids.',
  '- For facts about the user or the relationship, evidence must come from the user side (role=user). Do not use the character\'s own replies as evidence about the user.',
  '- Use revise only for wording or attribute fixes; use supersede when a state, preference, or boundary changes value.',
  '- Ordinary life changes are not conflicts: close the old interval with supersede and open a new one.',
  '- Events are append-only. Do not overwrite an event; merge exact duplicates instead.',
  '- Commitments must stay visible until fulfilled or expired.',
  '- Global user facts (subject=user, character_id null) should only be used for durable facts that apply across every character.',
  '- Do not store small talk, one-off moods, or anything already covered by the narrative unless it is durable.',
  '- Never store credentials, addresses with unit numbers, ID numbers, bank cards, or passwords.',
  '- Keep the summary under 300 characters. Preserve names, times, changes, and unresolved threads.',
  '- If nothing new is worth remembering, return an empty ops array and keep the summary close to the previous one.',
].join('\n');

export function buildMemoryOpsPrompt(digest: string) {
  return [
    MEMORY_OPS_TASK_PROMPT,
    '',
    'Current memory state and new evidence:',
    digest,
  ].join('\n');
}

export const EXPERIENCE_SYSTEM_PROMPT = [
  'Internal Herein experience worker.',
  'You are not the chat character. You turn structured observations into short first-person-adjacent experiences the character actually had.',
  'Return exactly one JSON object. No markdown, no prose.',
].join('\n');

export const EXPERIENCE_TASK_PROMPT = [
  'Given the observations below, write zero to three experiences.',
  'Output shape:',
  JSON.stringify({
    experiences: [
      {
        kind: 'watched_video | listened_music | read_group | saw_post',
        title: 'short title',
        summary: 'one sentence about the content',
        reaction: 'one short reaction in the character\'s own voice',
        importance: 1,
        sourceObservationIds: ['obs-id'],
      },
    ],
  }, null, 2),
  '',
  'Rules:',
  '- Only use title, description, subtitle, lyrics, or tags present in the observation. Never invent content.',
  '- Do not write reviews or summaries of themes. A reaction is short and specific.',
  '- One observation belongs to at most one experience.',
  '- If nothing is worth keeping, return an empty array.',
].join('\n');

export function buildExperiencePrompt(observations: string) {
  return [
    EXPERIENCE_TASK_PROMPT,
    '',
    'Observations:',
    observations,
  ].join('\n');
}
