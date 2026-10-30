import { Clip } from '../types';
import { generateId } from '../utils';

/**
 * #28: port of the macOS app's LinkedRecordingClips.companions (FrameCutEditor #64).
 *
 * Given the screen-track clips before (`original`) and after (`replacement`) an edit, rebuild the
 * companion clips on another track (`otherTrack`, e.g. narration) so every clip of a recording
 * (same `recordingLinkID`) keeps identical timing: offset, source range and speed.
 * Companions keep their own non-timing fields (mute etc.). Groups whose screen clips did not
 * change timing are left untouched; deleting all screen clips of a group deletes its companions.
 */
const EPS = 1e-6;

export const sameTiming = (a: Clip, b: Clip) =>
  Math.abs(a.offset - b.offset) < EPS &&
  Math.abs(a.sourceStart - b.sourceStart) < EPS &&
  Math.abs(a.sourceEnd - b.sourceEnd) < EPS &&
  Math.abs(a.speed - b.speed) < EPS;

export const linkedCompanions = (original: Clip[], replacement: Clip[], otherTrack: Clip[]): Clip[] => {
  const replacementsById = new Map(replacement.map(c => [c.id, c]));
  const groups = new Set<string>();
  for (const clip of original) {
    if (!clip.recordingLinkID) continue;
    const next = replacementsById.get(clip.id);
    if (!next || !sameTiming(clip, next)) groups.add(clip.recordingLinkID);
  }
  // Newly created clips (e.g. split halves) in a linked group also mark it changed.
  for (const clip of replacement) {
    if (clip.recordingLinkID && !original.some(o => o.id === clip.id)) groups.add(clip.recordingLinkID);
  }
  if (groups.size === 0) return otherTrack;

  let result = [...otherTrack];
  for (const group of groups) {
    const originals = original.filter(c => c.recordingLinkID === group);
    const companions = otherTrack.filter(c => c.recordingLinkID === group);
    const template = companions[0];
    if (!template) continue;
    result = result.filter(c => c.recordingLinkID !== group);
    for (const clip of replacement) {
      if (clip.recordingLinkID !== group) continue;
      const orig = originals.find(o => o.id === clip.id);
      const source = orig ?? originals.find(o => o.sourceStart <= clip.sourceStart + EPS && clip.sourceEnd <= o.sourceEnd + EPS);
      const matching = source ? companions.find(c => sameTiming(c, source)) : undefined;
      const companion: Clip = { ...(matching ?? template) };
      if (!orig || !matching) companion.id = generateId();
      companion.offset = clip.offset;
      companion.sourceStart = clip.sourceStart;
      companion.sourceEnd = clip.sourceEnd;
      companion.speed = clip.speed;
      result.push(companion);
    }
  }
  return result.sort((a, b) => (a.offset === b.offset ? (a.id < b.id ? -1 : 1) : a.offset - b.offset));
};

/** The screen clip a linked companion mirrors (same link id and timing), if any. */
export const linkedScreenClip = (companion: Clip, screenClips: Clip[]): Clip | undefined =>
  companion.recordingLinkID
    ? screenClips.find(c => c.recordingLinkID === companion.recordingLinkID && sameTiming(c, companion))
    : undefined;
