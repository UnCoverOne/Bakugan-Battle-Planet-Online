import { EngineCommandError, EngineInvariantError } from "./types";

export type RandomSource = {
  nextUint32(): number;
  nextFloat(): number;
  fillBytes(target: Uint8Array): Uint8Array;
  uuid(): `${string}-${string}-${string}-${string}-${string}`;
};

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitMix32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
}

export class SeededRandomSource implements RandomSource {
  private readonly state: Uint32Array;

  constructor(seed: string) {
    const expand = splitMix32(hashSeed(seed || "bakugan-engine-default-seed"));
    this.state = new Uint32Array([expand(), expand(), expand(), expand()]);
    if (this.state.every((value) => value === 0)) this.state[0] = 1;
  }

  nextUint32() {
    const state = this.state;
    const result = Math.imul(((state[1] * 5) << 7) | ((state[1] * 5) >>> 25), 9) >>> 0;
    const temporary = (state[1] << 9) >>> 0;

    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= temporary;
    state[3] = ((state[3] << 11) | (state[3] >>> 21)) >>> 0;

    return result;
  }

  nextFloat() {
    return this.nextUint32() / 0x1_0000_0000;
  }

  fillBytes(target: Uint8Array) {
    let value = 0;
    let remaining = 0;
    for (let index = 0; index < target.length; index += 1) {
      if (remaining === 0) {
        value = this.nextUint32();
        remaining = 4;
      }
      target[index] = value & 0xff;
      value >>>= 8;
      remaining -= 1;
    }
    return target;
  }

  uuid() {
    const bytes = this.fillBytes(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
  }
}

type PropertyPatch = {
  target: object;
  key: PropertyKey;
  descriptor?: PropertyDescriptor;
};

function installPatch(target: object, key: PropertyKey, value: unknown): PropertyPatch {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      writable: true,
      value,
    });
  } catch (error) {
    throw new EngineInvariantError(
      "DETERMINISTIC_RUNTIME_UNAVAILABLE",
      `The runtime cannot temporarily replace ${String(key)} for deterministic execution: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { target, key, descriptor };
}

function restorePatch(patch: PropertyPatch) {
  if (patch.descriptor) Object.defineProperty(patch.target, patch.key, patch.descriptor);
  else delete (patch.target as Record<PropertyKey, unknown>)[patch.key];
}

export type DeterministicRuntimeOptions = {
  now: number;
  randomSeed: string;
};

/**
 * Runs one synchronous engine transition against an injected clock and seeded
 * random source. The callback must never await. JavaScript cannot interleave a
 * second request while this synchronous section is executing, and every patched
 * global is restored in a finally block.
 */
export function withDeterministicRuntime<T>(
  options: DeterministicRuntimeOptions,
  callback: (random: RandomSource) => T,
): T {
  if (!Number.isFinite(options.now)) {
    throw new EngineCommandError("INVALID_ENGINE_TIME", "The command timestamp must be finite.");
  }

  const random = new SeededRandomSource(options.randomSeed);
  const patches: PropertyPatch[] = [];
  try {
    patches.push(installPatch(Date, "now", () => options.now));
    patches.push(installPatch(Math, "random", () => random.nextFloat()));

    const cryptoApi = globalThis.crypto;
    if (cryptoApi) {
      patches.push(installPatch(cryptoApi, "getRandomValues", <T extends ArrayBufferView | null>(view: T): T => {
        if (view == null) return view;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        random.fillBytes(bytes);
        return view;
      }));
      if (typeof cryptoApi.randomUUID === "function") {
        patches.push(installPatch(cryptoApi, "randomUUID", () => random.uuid()));
      }
    }

    return callback(random);
  } finally {
    for (const patch of patches.reverse()) restorePatch(patch);
  }
}
