import { SpitePlayer } from './element.js';

export { SpitePlayer, type FallbackReason } from './element.js';
export { EngineNode, defaultWorkletUrl } from './audio.js';
export {
  LoadError,
  loadManifest,
  loadPerformance,
  streamPerformance,
  type LoadOptions,
  type StreamOptions,
  type Performance,
} from './loader.js';
export { Lanes, layoutLanes, type BlockState } from './lanes.js';
export { randomSeed } from './seed.js';
export { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from './protocol.js';

if (!customElements.get('spite-player')) {
  customElements.define('spite-player', SpitePlayer);
}
