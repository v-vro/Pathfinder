// What the needle meets along a path, in order of depth. Built from the existing path analysis (no new sampling).
import type { PathAnalysis } from './pathAnalysis';
import { dot, sub } from './vec';

export type EventTone = 'plain' | 'warn' | 'bad';

export interface PathEvent {
  depthMm: number;
  label: string;
  tone: EventTone;
}

export function pathEvents(a: PathAnalysis): { events: PathEvent[]; stopMm: number } {
  const ev: PathEvent[] = [{ depthMm: 0, label: 'Skin', tone: 'plain' }];
  const along = (p: [number, number, number]) => dot(sub(p, a.entry), a.dir);

  if (a.chestWallMm !== null) ev.push({ depthMm: a.chestWallMm, label: 'Pleura, enters the lung', tone: 'plain' });
  for (const f of a.fissures) ev.push({ depthMm: f.depthMm, label: `Crosses the ${f.name}`, tone: 'bad' });
  if (a.fissureNear)
    ev.push({ depthMm: along(a.fissureNear.at), label: `${a.fissureNear.distanceMm.toFixed(0)} mm from the ${a.fissureNear.name}`, tone: 'warn' });
  for (const v of a.vesselsCrossed) ev.push({ depthMm: v.depthMm, label: `Through a ${v.caliberMm.toFixed(1)} mm vessel`, tone: 'bad' });
  const nv = a.nearestVessel;
  if (nv && !a.vesselsCrossed.length)
    ev.push({
      depthMm: nv.depthMm,
      label: `${nv.clearanceMm.toFixed(0)} mm from a ${nv.caliberMm.toFixed(1)} mm vessel`,
      tone: nv.clearanceMm < 2 ? 'bad' : nv.clearanceMm < 5 ? 'warn' : 'plain',
    });

  // the first thing that physically stops the needle ends the path
  const stop = a.blockers.filter((b) => b.kind !== 'length').sort((x, y) => x.depthMm - y.depthMm)[0];
  if (stop) ev.push({ depthMm: stop.depthMm, label: `Hits ${stop.name}`, tone: 'bad' });
  const stopMm = stop ? stop.depthMm : a.totalMm;

  if (a.lesionDepthMm !== null) ev.push({ depthMm: a.lesionDepthMm, label: 'Reaches the nodule', tone: 'plain' });
  ev.push({ depthMm: a.totalMm, label: 'Nodule centre', tone: 'plain' });

  const events = ev.filter((e) => e.depthMm <= stopMm + 0.5).sort((x, y) => x.depthMm - y.depthMm);
  return { events, stopMm };
}
