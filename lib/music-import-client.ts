const OPUS_SAMPLE_RATE = 48_000;
const OPUS_FRAME_SAMPLES = 960;
const DEFAULT_OPUS_BITRATE = 96_000;

type EncodedChunkLike = {
  byteLength: number;
  copyTo(destination: Uint8Array): void;
};

type EncodedMetadataLike = {
  decoderConfig?: {
    description?: ArrayBuffer | ArrayBufferView;
  };
};

type AudioDataLike = { close(): void };
type AudioDataConstructor = new (init: {
  format: "f32-planar";
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: Float32Array;
}) => AudioDataLike;

type AudioEncoderLike = {
  encodeQueueSize: number;
  configure(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    bitrate: number;
  }): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
};

type AudioEncoderConstructor = {
  new (init: {
    output: (chunk: EncodedChunkLike, metadata?: EncodedMetadataLike) => void;
    error: (error: DOMException) => void;
  }): AudioEncoderLike;
  isConfigSupported(config: {
    codec: string;
    sampleRate: number;
    numberOfChannels: number;
    bitrate: number;
  }): Promise<{ supported?: boolean }>;
};

type WebCodecsScope = typeof globalThis & {
  AudioEncoder?: AudioEncoderConstructor;
  AudioData?: AudioDataConstructor;
};

export type ConvertedMusicFile = {
  blob: Blob;
  fileName: string;
  durationMs: number;
  bitrate: number;
};

function writeUint32LE(target: Uint8Array, offset: number, value: number) {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  view.setUint32(offset, value >>> 0, true);
}

function writeUint64LE(target: Uint8Array, offset: number, value: number) {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  const low = value >>> 0;
  const high = Math.floor(value / 0x1_0000_0000) >>> 0;
  view.setUint32(offset, low, true);
  view.setUint32(offset + 4, high, true);
}

function oggCrc(data: Uint8Array) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) : (crc << 1)) >>> 0;
    }
  }
  return crc >>> 0;
}

function lacingForPacket(length: number) {
  const segments: number[] = [];
  let remaining = length;
  while (remaining >= 255) {
    segments.push(255);
    remaining -= 255;
  }
  segments.push(remaining);
  return segments;
}

function oggPage(
  packets: Uint8Array[],
  serial: number,
  sequence: number,
  granulePosition: number,
  headerType: number,
) {
  const lacing = packets.flatMap((packet) => lacingForPacket(packet.byteLength));
  const payloadBytes = packets.reduce((sum, packet) => sum + packet.byteLength, 0);
  const page = new Uint8Array(27 + lacing.length + payloadBytes);
  page.set(new TextEncoder().encode("OggS"), 0);
  page[4] = 0;
  page[5] = headerType;
  writeUint64LE(page, 6, granulePosition);
  writeUint32LE(page, 14, serial);
  writeUint32LE(page, 18, sequence);
  writeUint32LE(page, 22, 0);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let cursor = 27 + lacing.length;
  for (const packet of packets) {
    page.set(packet, cursor);
    cursor += packet.byteLength;
  }
  writeUint32LE(page, 22, oggCrc(page));
  return page;
}

function opusHead(channels: number, preSkip: number) {
  const packet = new Uint8Array(19);
  packet.set(new TextEncoder().encode("OpusHead"), 0);
  packet[8] = 1;
  packet[9] = channels;
  const view = new DataView(packet.buffer);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, OPUS_SAMPLE_RATE, true);
  view.setInt16(16, 0, true);
  packet[18] = 0;
  return packet;
}

function opusTags() {
  const vendor = new TextEncoder().encode("Bakugan Battle Planet Online");
  const packet = new Uint8Array(8 + 4 + vendor.length + 4);
  packet.set(new TextEncoder().encode("OpusTags"), 0);
  const view = new DataView(packet.buffer);
  view.setUint32(8, vendor.length, true);
  packet.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);
  return packet;
}

function descriptionBytes(description: ArrayBuffer | ArrayBufferView | undefined) {
  if (!description) return null;
  if (description instanceof ArrayBuffer) return new Uint8Array(description);
  return new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
}

function opusPreSkip(description: Uint8Array | null) {
  if (!description || description.byteLength < 12) return 312;
  const marker = new TextDecoder().decode(description.slice(0, 8));
  if (marker === "OpusHead") return new DataView(description.buffer, description.byteOffset).getUint16(10, true);
  return 312;
}

export function muxOggOpus(
  packets: Uint8Array[],
  totalSamples: number,
  channels = 2,
  preSkip = 312,
  serial = 0x4250504f,
) {
  if (!packets.length) throw new Error("The Opus encoder returned no audio packets.");
  const pages: Uint8Array[] = [
    oggPage([opusHead(channels, preSkip)], serial, 0, 0, 2),
    oggPage([opusTags()], serial, 1, 0, 0),
  ];
  let sequence = 2;
  let packetIndex = 0;
  while (packetIndex < packets.length) {
    const pagePackets: Uint8Array[] = [];
    let segments = 0;
    let payload = 0;
    const firstIndex = packetIndex;
    while (packetIndex < packets.length) {
      const packet = packets[packetIndex];
      const packetSegments = lacingForPacket(packet.byteLength).length;
      if (pagePackets.length && (segments + packetSegments > 255 || payload + packet.byteLength > 60 * 1024)) break;
      pagePackets.push(packet);
      segments += packetSegments;
      payload += packet.byteLength;
      packetIndex += 1;
    }
    const completedPackets = firstIndex + pagePackets.length;
    const endSamples = Math.min(totalSamples, completedPackets * OPUS_FRAME_SAMPLES);
    const finalPage = packetIndex >= packets.length;
    pages.push(oggPage(
      pagePackets,
      serial,
      sequence,
      preSkip + endSamples,
      finalPage ? 4 : 0,
    ));
    sequence += 1;
  }
  return new Blob(pages, { type: "audio/ogg" });
}

async function decodeFile(file: File) {
  const AudioContextApi = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextApi) throw new Error("This browser cannot decode audio files.");
  const context = new AudioContextApi();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
}

function outputName(file: File) {
  const stem = file.name.replace(/\.[^.]+$/, "").trim() || "track";
  return `${stem}.opus`;
}

export async function convertMusicFileToOpus(
  file: File,
  onProgress?: (progress: number, label: string) => void,
): Promise<ConvertedMusicFile> {
  onProgress?.(0.03, "Decoding source audio…");
  const decoded = await decodeFile(file);
  const durationMs = Math.max(1, Math.round(decoded.duration * 1000));

  if (/\.opus$/i.test(file.name) && (file.type === "audio/ogg" || file.type === "audio/opus" || !file.type)) {
    onProgress?.(1, "Opus file ready.");
    return {
      blob: new Blob([await file.arrayBuffer()], { type: "audio/ogg" }),
      fileName: outputName(file),
      durationMs,
      bitrate: Math.round(file.size * 8 / Math.max(.001, decoded.duration)),
    };
  }

  const codecs = globalThis as WebCodecsScope;
  if (!codecs.AudioEncoder || !codecs.AudioData) {
    throw new Error("This browser cannot convert audio to Opus. Use a current Chromium browser or import an existing .opus file.");
  }
  const config = {
    codec: "opus",
    sampleRate: OPUS_SAMPLE_RATE,
    numberOfChannels: 2,
    bitrate: DEFAULT_OPUS_BITRATE,
  };
  const support = await codecs.AudioEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error("This browser does not provide an Opus encoder. Import an existing .opus file instead.");
  }

  onProgress?.(.12, "Resampling to 48 kHz stereo…");
  const totalSamples = Math.max(1, Math.ceil(decoded.duration * OPUS_SAMPLE_RATE));
  const offline = new OfflineAudioContext(2, totalSamples, OPUS_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const packets: Uint8Array[] = [];
  let encoderError: Error | null = null;
  let decoderDescription: Uint8Array | null = null;
  const encoder = new codecs.AudioEncoder({
    output: (chunk, metadata) => {
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      packets.push(packet);
      if (!decoderDescription) decoderDescription = descriptionBytes(metadata?.decoderConfig?.description);
    },
    error: (error) => {
      encoderError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure(config);

  const frames = Math.ceil(totalSamples / OPUS_FRAME_SAMPLES);
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1));
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * OPUS_FRAME_SAMPLES;
    const planar = new Float32Array(OPUS_FRAME_SAMPLES * 2);
    planar.set(left.subarray(offset, Math.min(totalSamples, offset + OPUS_FRAME_SAMPLES)), 0);
    planar.set(right.subarray(offset, Math.min(totalSamples, offset + OPUS_FRAME_SAMPLES)), OPUS_FRAME_SAMPLES);
    const data = new codecs.AudioData({
      format: "f32-planar",
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfFrames: OPUS_FRAME_SAMPLES,
      numberOfChannels: 2,
      timestamp: Math.round(offset * 1_000_000 / OPUS_SAMPLE_RATE),
      data: planar,
    });
    encoder.encode(data);
    data.close();
    if (frame % 24 === 0) {
      onProgress?.(.18 + .72 * (frame / Math.max(1, frames)), "Encoding Opus…");
      if (encoder.encodeQueueSize > 24) await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  onProgress?.(.94, "Building Ogg Opus stream…");
  const blob = muxOggOpus(packets, totalSamples, 2, opusPreSkip(decoderDescription));
  onProgress?.(1, "Conversion complete.");
  return {
    blob,
    fileName: outputName(file),
    durationMs,
    bitrate: DEFAULT_OPUS_BITRATE,
  };
}
