import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { VoiceWorkers } = require(path.resolve(process.argv[2]));
const workers = Object.create(VoiceWorkers.prototype);
workers.config = { tts: { provider: "qwen-gguf" } };
workers.sequence = 0;
const worker = new EventEmitter();
worker.ready = true; worker.closed = false;
worker.child = { stdout: { pause() {}, resume() {} } };
let command, unhandled = 0, chunks = 0, settled = false, rejected = false;
worker.send = value => { if (!value.cancel) command = value; };
worker.close = () => {
  if (worker.closed) return;
  worker.closed = true;
  worker.emit("failure", new Error("fixture worker closed"));
};
workers.qwen = worker;
process.on("unhandledRejection", () => { unhandled++; });
const task = workers.speak({ text: "fixture" }, 1, async () => {
  chunks++;
  throw new Error("fixture ACK failed");
});
task.then(() => { settled = true; }, () => { settled = rejected = true; });
worker.emit("message", { id: command.id, pcm: Buffer.alloc(4800).toString("base64") });
worker.emit("message", { id: command.id, pcm: Buffer.alloc(4800).toString("base64") });
await new Promise(resolve => setTimeout(resolve, 150));
const report = { settledBeforeDone: settled, rejectedBeforeDone: rejected,
  unhandledRejections: unhandled, workerClosed: worker.closed,
  chunks, messageListeners: worker.listenerCount("message") };
worker.close(); await task.catch(() => {});
console.log(JSON.stringify(report));
process.exit(report.settledBeforeDone && report.rejectedBeforeDone && report.unhandledRejections === 0 &&
  report.workerClosed && report.messageListeners === 0 && report.chunks === 1 ? 0 : 1);
