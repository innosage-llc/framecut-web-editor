import { AudioRole, Clip } from '../types';

/** #28: lane labels, same order and names as the macOS app. */
export const AUDIO_LANES: { role: AudioRole; label: string; title: string }[] = [
  { role: 'system', label: 'A1', title: 'System Audio' },
  { role: 'narration', label: 'A2', title: 'Narration' },
  { role: 'music', label: 'A3', title: 'Music' },
];

export const audioRoleOf = (clip: Pick<Clip, 'mediaType'>): AudioRole =>
  clip.mediaType === 'narration' ? 'narration' : clip.mediaType === 'audio' ? 'music' : 'system';

/** Lane mutes; the legacy single audio-track mute maps to the Music lane. */
export const effectiveMutedRoles = (state: { mutedAudioRoles?: AudioRole[]; isAudioTrackMuted?: boolean }): Set<AudioRole> => {
  const set = new Set<AudioRole>(state.mutedAudioRoles ?? []);
  if (state.isAudioTrackMuted) set.add('music');
  return set;
};

/** Same rule for preview and export: clip mute and lane mute are independent. */
export const isClipAudible = (clip: Clip, muted: Set<AudioRole>): boolean => {
  const role = audioRoleOf(clip);
  if (muted.has(role)) return false;
  // Historical behaviour: background-music clips ignore clip.muted.
  if (role === 'music') return true;
  return !clip.muted;
};

/**
 * Where a narration clip's audio plays. Narration clips use screen-source time; the narration
 * media starts `timeOffset` seconds into the screen source (late mic start) or before it (negative).
 * Returns timeline start (`when`), buffer offset and source-seconds to play, or null if silent.
 */
export const narrationWindow = (clip: Clip, timeOffset: number, mediaDuration = Infinity) => {
  const mediaStart = clip.sourceStart - timeOffset;
  const mediaEnd = Math.min(clip.sourceEnd - timeOffset, mediaDuration);
  const bufferOffset = Math.max(0, mediaStart);
  if (mediaEnd <= bufferOffset) return null;
  const when = clip.offset + (bufferOffset - mediaStart) / clip.speed;
  return { when, bufferOffset, playDuration: mediaEnd - bufferOffset };
};

/** Narration media time for a screen-source time (null when before the mic started). */
export const narrationMediaTime = (sourceTime: number, timeOffset: number) => {
  const t = sourceTime - timeOffset;
  return t < 0 ? null : t;
};
