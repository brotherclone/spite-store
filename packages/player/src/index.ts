import { SpitePlayer } from './element.js';

export { SpitePlayer, type FallbackReason } from './element.js';
export { EngineNode, defaultWorkletUrl } from './audio.js';
export {
  LoadError,
  loadManifest,
  loadPerformance,
  type LoadOptions,
  type Performance,
} from './loader.js';
export { Lanes, layoutLanes } from './lanes.js';
export { randomSeed } from './seed.js';
export { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from './protocol.js';

if (!customElements.get('spite-player')) {
  customElements.define('spite-player', SpitePlayer);
}
