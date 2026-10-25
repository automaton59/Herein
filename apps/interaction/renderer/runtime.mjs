import "./style.css";
import { VoiceActivity, TextSegments } from "./audio.mjs";
import { Avatar } from "./avatar.mjs";
const api = window.interaction;
const el = (id) => document.getElementById(id);
const boot = await api.bootstrap();
let avatar,
  context,
  out,
  gain,
  inputNode,
  inputSource,
  stream,
  desiredMic = false,
  reconnecting = false,
  asrBusy = false,
  asrReady = boot.asrReady;
let generation = 0,
  state = "idle",
  bufferMs = 0,
  underruns = 0,
  speechActive = false,
  outputEnded = true,
  mouth = 0,
  turnEnd = 0,
  firstRequest = 0,
  interruptAt = 0,
  levelShownAt = 0;
let cancelledSpeech = false,
  resumeListening = false,
  streamTurn = null,
  segmenter = null,
  textQueue = [],
  textDraining = false,
  pendingUtterance = null;
const utteranceTimes = new Map();
const pendingChunks = [];
let audioInit = null,
  micEpoch = 0;
const vad = new VoiceActivity(boot.config.vad);
function notice(text, error = false) {
  el("notice").textContent = text;
  el("notice").classList.toggle("error", error);
}
function setState(value) {
  state = value;
  avatar?.setState(value);
  el("state").textContent =
    {
      idle: "在这里",
      listening: "正在听",
      thinking: "处理中",
      speaking: "正在说",
      interrupted: "已打断",
      paused: "已暂停",
    }[value] || value;
  api.event({
    type: "presence",
    state,
    micActive: desiredMic && Boolean(stream),
  });
}
function stats(event) {
  api.event(event);
}
async function audio() {
  if (audioInit) return audioInit;
  audioInit = initializeAudio()
    .catch(async (error) => {
      out?.disconnect();
      await context?.close().catch(() => {});
      context = out = gain = null;
      throw error;
    })
    .finally(() => {
      audioInit = null;
    });
  return audioInit;
}
async function initializeAudio() {
  if (!context || context.state === "closed") {
    context = new AudioContext({
      sampleRate: 24000,
      latencyHint: "interactive",
    });
    await context.audioWorklet.addModule("/assets/worklet.js");
    out = new AudioWorkletNode(context, "herein-output", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        initialBufferMs: boot.config.provider.startsWith("qwen") ? 240 : 60,
      },
    });
    gain = context.createGain();
    gain.gain.value = boot.config.silentOutput ? 0 : 1;
    out.connect(gain).connect(context.destination);
    out.port.postMessage({ type: "cancel", generation });
    out.port.onmessage = ({ data }) => {
      if (data.generation !== undefined && data.generation !== generation)
        return;
      if (data.type === "level") {
        bufferMs = data.bufferMs;
        underruns = data.underruns;
        mouth = Math.min(1, data.rms * 5);
        if (avatar) avatar.mouth = mouth;
        flushPcm();
      }
      if (data.type === "sound") {
        const elapsed = performance.now() - firstRequest;
        stats({
          type: "playback.sound",
          generation,
          renderFirstMs: elapsed,
          endToSoundMs:
            turnEnd && performance.now() - turnEnd < 10000
              ? performance.now() - turnEnd
              : undefined,
        });
        turnEnd = 0;
      }
      if (data.type === "first") {
        speechActive = true;
        setState("speaking");
      }
      if (data.type === "drained") {
        speechActive = false;
        bufferMs = 0;
        if (avatar) avatar.mouth = 0;
        setState(desiredMic ? "listening" : "idle");
        drainText();
      }
      if (data.type === "cancelled" && interruptAt) {
        stats({
          type: "playback.interrupted",
          generation,
          interruptMs: performance.now() - interruptAt,
        });
        interruptAt = 0;
      }
      if (data.type === "overflow") {
        void interrupt("buffer overflow");
        notice("播放缓冲达到上限，已停止这一轮。", true);
      }
    };
    context.onstatechange = () => {
      if (context.state === "suspended" && desiredMic)
        notice("音频已暂停，恢复后自动重新连接。");
    };
  }
  if (context.state === "suspended") await context.resume();
  return context;
}
function flushPcm() {
  if (!out) return;
  while (pendingChunks.length) {
    const event = pendingChunks[0];
    if (event.generation !== generation) {
      pendingChunks.shift();
      api.ack(event.id);
      continue;
    }
    const samples = event.samples;
    if (bufferMs + (samples.length / context.sampleRate) * 1000 > 3500) return;
    pendingChunks.shift();
    bufferMs += (samples.length / context.sampleRate) * 1000;
    out.port.postMessage({ type: "pcm", generation, samples }, [
      samples.buffer,
    ]);
    api.ack(event.id);
  }
  if (outputEnded && !pendingChunks.length)
    out.port.postMessage({ type: "end", generation });
}
function stopLocal(reason) {
  interruptAt = performance.now();
  gain?.gain.setValueAtTime(0, context.currentTime);
  out?.port.postMessage({ type: "cancel", generation });
  for (const chunk of pendingChunks) api.ack(chunk.id);
  pendingChunks.length = 0;
  bufferMs = 0;
  speechActive = false;
  outputEnded = true;
  mouth = 0;
  if (avatar) avatar.mouth = 0;
  streamTurn = null;
  segmenter = null;
  textQueue = [];
  setState("interrupted");
  stats({ type: "interrupt.detected", reason });
}
async function interrupt(reason = "user") {
  cancelledSpeech = true;
  stopLocal(reason);
  generation = Math.max(generation, await api.cancel());
  out?.port.postMessage({ type: "cancel", generation });
}
async function speak(command) {
  await audio();
  firstRequest = performance.now();
  cancelledSpeech = false;
  setState("thinking");
  await api.speak(command);
}
async function transcript(utterance) {
  if (asrBusy) {
    pendingUtterance = utterance;
    return;
  }
  if (!asrReady) return;
  const { frames, endedAt, turnId } = utterance;
  const epoch = micEpoch;
  const requestGeneration = generation;
  asrBusy = true;
  setState("thinking");
  const total = frames.reduce((n, f) => n + f.length, 0);
  const pcm = new Int16Array(Math.min(total, 240000));
  let offset = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  for (const frame of frames) {
    for (const v of frame) {
      sumSquares += v * v;
      sampleCount += 1;
      if (offset >= pcm.length) break;
      pcm[offset++] = Math.max(-32768, Math.min(32767, v * 32767));
    }
  }
  try {
    const result = await api.transcribe(new Uint8Array(pcm.buffer), turnId);
    stats({
      type: "voice.turn",
      asrMs: result.elapsedMs,
      vadToAsrMs: performance.now() - endedAt,
      rms: Math.sqrt(sumSquares / Math.max(1, sampleCount)),
    });
    if (result.stale || epoch !== micEpoch || !desiredMic) return;
    // C may respond to the SSE transcript before this IPC promise resolves.
    // Do not replace that newer speech's visual state with "listening".
    if (requestGeneration !== generation || speechActive) return;
    if (result.text) {
      notice(`听到：${result.text}`);
      if (el("demo").checked && boot.config.demoReply)
        await speak({ text: boot.config.demoReply, turnId });
      else setState(desiredMic ? "listening" : "idle");
    } else {
      notice("没听清：检查输入设备和麦克风音量。", true);
      setState(desiredMic ? "listening" : "idle");
    }
  } catch (error) {
    notice(error.message, true);
    setState(desiredMic ? "listening" : "idle");
  } finally {
    asrBusy = false;
    if (pendingUtterance) {
      const frames = pendingUtterance;
      pendingUtterance = null;
      void transcript(frames);
    }
  }
}
async function startMic() {
  desiredMic = true;
  const epoch = ++micEpoch;
  await audio();
  if (epoch !== micEpoch || !desiredMic) return;
  await stopMic(false);
  try {
    const deviceId = el("input").value;
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    if (epoch !== micEpoch || !desiredMic) {
      for (const track of acquired.getTracks()) track.stop();
      return;
    }
    stream = acquired;
    inputSource = context.createMediaStreamSource(stream);
    inputNode = new AudioWorkletNode(context, "herein-input", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    inputSource.connect(inputNode);
    inputNode.port.onmessage = ({ data }) => {
      if (!desiredMic) return;
      const samples = data.samples || [];
      let energy = 0;

      for (let index = 0; index < samples.length; index += 1)
        energy += samples[index] * samples[index];

      const now = performance.now();

      if (now - levelShownAt > 100) {
        levelShownAt = now;
        el("level").value = Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 6);
      }

      const outputSpeaking = speechActive || bufferMs > 0;
      const result = vad.consume(data.samples, 20, outputSpeaking);
      for (const event of result.events) {
        if (event.type === "start") {
          if (outputSpeaking || state === "thinking") void interrupt("voice");
          setState("listening");
          api.event({ type: "vad", state: "start", at: Date.now() });
        }
        if (event.type === "end") {
          const endedAt = performance.now(),
            turnId = crypto.randomUUID();
          utteranceTimes.set(turnId, endedAt - vad.options.endMs);
          if (utteranceTimes.size > 16)
            utteranceTimes.delete(utteranceTimes.keys().next().value);
          api.event({ type: "vad", state: "end", at: Date.now() });
          void transcript({ frames: event.frames, endedAt, turnId });
        }
      }
    };
    for (const track of stream.getTracks())
      track.onended = () => recoverDevices();
    vad.reset();
    el("mic").textContent = "暂停监听";
    setState("listening");
    api.event({ type: "mic.preference", enabled: true });
    await devices();
    const settings = stream.getAudioTracks()[0].getSettings();
    notice(
      `持续监听已开启 · 回声消除 ${settings.echoCancellation ? "开启" : "未确认"} · ${boot.config.provider === "sapi" ? "系统声音降级" : "Qwen 本地声音"}`,
    );
  } catch (error) {
    if (epoch !== micEpoch) return;
    desiredMic = false;
    await stopMic();
    notice(`麦克风：${error.message}`, true);
  }
}
async function stopMic(changeDesired = true) {
  if (changeDesired) {
    micEpoch++;
    desiredMic = false;
    api.event({ type: "mic.preference", enabled: false });
  }
  inputNode?.disconnect();
  if (inputNode) {
    inputNode.port.onmessage = null;
    inputNode.port.close();
  }
  inputNode = null;
  inputSource?.disconnect();
  inputSource = null;
  for (const track of stream?.getTracks() || []) {
    track.onended = null;
    track.stop();
  }
  stream = null;
  pendingUtterance = null;
  utteranceTimes.clear();
  vad.reset();
  el("mic").textContent = "开始监听";
  if (changeDesired) setState("paused");
}
async function devices() {
  const list = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [
    ["input", "audioinput"],
    ["output", "audiooutput"],
  ]) {
    const selected = el(id).value;
    el(id).replaceChildren(new Option("系统默认", ""));
    for (const device of list.filter(
      (d) => d.kind === kind && d.deviceId !== "default",
    ))
      el(id).add(
        new Option(
          device.label || `${kind} ${device.deviceId.slice(0, 5)}`,
          device.deviceId,
        ),
      );
    if ([...el(id).options].some((o) => o.value === selected))
      el(id).value = selected;

    if (id === "input" && !el(id).value) {
      const saved = localStorage.getItem("herein.inputDevice");

      if (saved && [...el(id).options].some((o) => o.value === saved))
        el(id).value = saved;
      else {
        const physical = [...el(id).options].find(
          (option) =>
            option.value &&
            /麦克风|microphone|mic/i.test(option.text) &&
            !/virtual|stereo|nvidia|line/i.test(option.text),
        );
        if (physical) el(id).value = physical.value;
      }
    }
  }
}
async function recoverDevices() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    await devices();
    if (desiredMic) await startMic();
    if (context && "setSinkId" in context)
      await context.setSinkId(el("output").value);
  } catch (error) {
    notice(`设备恢复：${error.message}`, true);
  } finally {
    reconnecting = false;
  }
}
async function drainText() {
  if (
    textDraining ||
    speechActive ||
    state === "thinking" ||
    bufferMs ||
    !textQueue.length
  )
    return;
  textDraining = true;
  const next = textQueue.shift();
  speechActive = true;
  try {
    await speak(next);
  } catch (error) {
    speechActive = false;
    notice(error.message, true);
  } finally {
    textDraining = false;
  }
}
const unsubscribe = api.on(async (event) => {
  if (event.type === "cancel") {
    if (event.generation < generation) return;
    generation = event.generation;
    if (event.reason !== "replace") interruptAt ||= performance.now();
    gain?.gain.setValueAtTime(0, context.currentTime);
    out?.port.postMessage({ type: "cancel", generation });
    for (const chunk of pendingChunks) api.ack(chunk.id);
    pendingChunks.length = 0;
    bufferMs = 0;
    speechActive = false;
    outputEnded = true;
    mouth = 0;
    if (avatar) avatar.mouth = 0;
    if (event.reason !== "replace") {
      streamTurn = null;
      segmenter = null;
      textQueue = [];
      setState(desiredMic ? "listening" : "interrupted");
    }
  }
  if (event.type === "speech.begin") {
    await audio();
    if (event.generation !== generation) return;
    if (event.turnId !== streamTurn) {
      streamTurn = null;
      segmenter = null;
      textQueue = [];
    }
    turnEnd = utteranceTimes.get(event.turnId) || 0;
    utteranceTimes.delete(event.turnId);
    cancelledSpeech = false;
    out.port.postMessage({ type: "cancel", generation });
    gain.gain.setValueAtTime(boot.config.silentOutput ? 0 : 1, context.currentTime);
    outputEnded = false;
    speechActive = true;
    firstRequest = performance.now();
    avatar?.expression(event.emotion);
    setState("thinking");
    flushPcm();
  }
  if (event.type === "pcm") {
    if (event.generation !== generation || cancelledSpeech) {
      api.ack(event.id);
      return;
    }
    await audio();
    if (event.generation !== generation || cancelledSpeech) {
      api.ack(event.id);
      return;
    }
    const bytes = new Uint8Array(event.pcm);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = Math.floor(bytes.length / 2);
    const rate = context.sampleRate;
    const samples = new Float32Array(Math.round((count * rate) / 24000));
    for (let i = 0; i < samples.length; i++) {
      const pos = (i * 24000) / rate;
      const j = Math.min(count - 1, Math.floor(pos));
      const k = Math.min(count - 1, j + 1);
      samples[i] =
        (view.getInt16(j * 2, true) * (1 - (pos - j)) +
          view.getInt16(k * 2, true) * (pos - j)) /
        32768;
    }
    pendingChunks.push({ ...event, samples });
    if (pendingChunks.length > 2) {
      void interrupt("backpressure");
      notice("音频积压，已停止这一轮。", true);
    } else flushPcm();
    if (event.first)
      stats({
        type: "tts.first",
        generation,
        provider: event.provider,
        firstMs: event.firstMs,
      });
  }
  if (event.type === "speech.end" && event.generation === generation) {
    outputEnded = true;
    flushPcm();
  }
  if (event.type === "speech.error" && event.generation === generation) {
    outputEnded = true;
    flushPcm();
    speechActive = false;
    notice(event.error, true);
    setState(desiredMic ? "listening" : "idle");
  }
  if (event.type === "capability" && event.asr) {
    asrReady = event.asr === "ready";
    notice(
      asrReady ? "本地识别已就绪。" : "本地识别不可用，等待恢复。",
      !asrReady,
    );
  }
  if (event.type === "avatar") {
    avatar?.expression(event.emotion);
    if (event.motion) avatar?.motion(event.motion);
  }
  if (event.type === "text") {
    try {
      if (event.op === "begin") {
        cancelledSpeech = false;
        streamTurn = event.turnId;
        segmenter = new TextSegments();
      } else if (event.turnId === streamTurn && segmenter) {
        const parts = segmenter.append(
          event.op === "delta" ? event.text : "",
          event.op === "end",
        );
        if (textQueue.length + parts.length > 8)
          throw new Error("Speech text queue full");
        textQueue.push(
          ...parts.map((text) => ({
            text,
            emotion: event.emotion || "neutral",
            turnId: event.turnId,
          })),
        );
        void drainText();
      }
    } catch (error) {
      await interrupt("text overflow");
      notice(error.message, true);
    }
  }
  if (event.type === "mic.toggle")
    desiredMic ? await stopMic() : await startMic();
  if (event.type === "mic.set")
    event.enabled ? await startMic() : await stopMic();
  if (event.type === "suspend") {
    resumeListening = desiredMic;
    micEpoch++;
    await stopMic(false);
    setState("paused");
    await context?.suspend();
  }
  if (event.type === "resume") {
    await audio();
    if (resumeListening) {
      desiredMic = true;
      await recoverDevices();
    }
    resumeListening = false;
  }
  if (event.type === "visibility") avatar?.hidden(event.hidden);
});
el("mic").onclick = () => (desiredMic ? stopMic() : startMic());
el("stop").onclick = () => interrupt("button");
el("hide").onclick = () => api.window("hide");
el("say").onclick = () => {
  turnEnd = 0;
  void speak({ text: el("text").value }).catch((error) =>
    notice(error.message, true),
  );
};
el("input").onchange = () => {
  localStorage.setItem("herein.inputDevice", el("input").value);
  if (desiredMic) void startMic();
};
el("output").onchange = async () => {
  try {
    await audio();
    if ("setSinkId" in context) await context.setSinkId(el("output").value);
    else notice("此音频后端不支持指定输出设备。", true);
  } catch (error) {
    notice(`输出设备：${error.message}`, true);
  }
};
el("top").onchange = () => api.window("top", el("top").checked);
el("fps").value = String(boot.config.fps);
el("fps").onchange = () => avatar?.setFps(Number(el("fps").value));
const framingLabel = document.createElement("label");
framingLabel.textContent = "取景";
const framingSelect = document.createElement("select");
for (const [value, label] of [["bust", "肖像"], ["half", "半身"], ["full", "全身"]])
  framingSelect.add(new Option(label, value));
framingSelect.value = boot.config.framing || "bust";
framingSelect.onchange = () => avatar?.setFraming(framingSelect.value);
framingLabel.appendChild(framingSelect);
el("panel").prepend(framingLabel);
for (const [id, entries] of [["expression", boot.manifest.expressions], ["motion", boot.manifest.motions]])
  for (const name of Object.keys(entries || {})) el(id).add(new Option(name, name));
el("expression").onchange = () => avatar?.expression(el("expression").value);
el("perform").onclick = () => avatar?.motion(el("motion").value);
el("rest").onclick = () => {
  avatar?.expression("neutral");
  avatar?.motion(boot.manifest.states?.[state] || "idle");
  el("expression").value = "neutral";
};
navigator.mediaDevices.ondevicechange = () => recoverDevices();
let drag = null;
el("avatar").onpointerdown = (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  drag = { x: event.screenX, y: event.screenY, moved: false };
  el("avatar").setPointerCapture(event.pointerId);
};
el("avatar").onpointermove = (event) => {
  if (!drag) return;
  const x = event.screenX - drag.x,
    y = event.screenY - drag.y;
  if (Math.abs(x) + Math.abs(y) > 3) {
    drag.moved = true;
    void api.window("move", { x, y });
    drag.x = event.screenX;
    drag.y = event.screenY;
  }
};
el("avatar").onpointerup = () => {
  if (drag) avatar?.interact(drag.moved ? "drag" : "tap");
  drag = null;
};
el("avatar").onpointercancel = () => { drag = null; };
try {
  avatar = new Avatar(el("avatar"), boot.manifest, boot.config.fps, boot.config.framing);
  await avatar.load();
  if (boot.config.diagnostics) {
    window.interactionAvatarDiagnostic = () => avatar.diagnostic();
    window.interactionAvatarExercise = async value => {
      if (["tap", "drag"].includes(value.action)) await avatar.interact(value.action);
      if (value.action === "focus") avatar.focus(value.x, value.y);
      if (value.action === "center") avatar.model.internalModel.focusController.focus(0, 0);
      return { accepted: true, simulated: true };
    };
  }
  notice("形象已就绪；可开始监听或接收 C 的发声命令。");
} catch (error) {
  console.error(error);
  avatar.errors++;
  avatar.destroy();
  notice(error.message, true);
  stats({ type: "avatar.error", reason: "load_failed" });
}
await devices();
setState("idle");
if (boot.config.autoListen) await startMic();
const timer = setInterval(() => {
  const visual = avatar?.stats() || {};
  const event = {
    type: "renderer.sample",
    ...visual,
    bufferMs,
    underruns,
    tracks: stream?.getTracks().length || 0,
    audioContexts: context && context.state !== "closed" ? 1 : 0,
    state,
  };
  stats(event);
  el("metrics").textContent =
    `${boot.config.provider} · ${Math.round(visual.fps || 0)}fps · 缓冲 ${Math.round(bufferMs)}ms · 欠供 ${underruns} · ${state}`;
}, 5000);
window.addEventListener("beforeunload", () => {
  clearInterval(timer);
  unsubscribe();
  void stopMic(false);
  out?.disconnect();
  void context?.close();
  avatar?.destroy();
});
