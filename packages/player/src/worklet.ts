import { Mixer } from './mixer.js';
import { PROCESSOR_NAME, type FromWorklet, type ToWorklet } from './protocol.js';

/** The audio-thread side: hands messages and output blocks to the Mixer, which does the work. */
class SpiteProcessor extends AudioWorkletProcessor {
  private readonly mixer = new Mixer((message: FromWorklet) => this.port.postMessage(message));

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ToWorklet>) => this.mixer.receive(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    this.mixer.process(out[0]!, out[1] ?? out[0]!);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SpiteProcessor);
