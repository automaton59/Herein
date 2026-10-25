"""Qwen codec-prefix PCM streaming, with process-local hooks and cancellation.

No upstream files are patched. Prefix decoding retains two codec frames as
lookahead. This adapter exposes measured underruns; it cannot fix slow inference.
"""
import argparse
import base64
import json
import queue
import sys
import threading
import time

import numpy as np
import torch
from qwen_tts import Qwen3TTSModel
from transformers import StoppingCriteria, StoppingCriteriaList


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    torch.set_num_threads(4)
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16,
                                         attn_implementation='sdpa', local_files_only=True)
    commands = queue.Queue(maxsize=1)
    cancelled = threading.Event()
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            print(json.dumps(value), flush=True)

    def reader():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                if command.get('cancel'):
                    cancelled.set()
                else:
                    commands.put_nowait(command)
            except (ValueError, queue.Full):
                emit({'error': 'invalid_or_busy'})
        cancelled.set()
        commands.put(None)

    threading.Thread(target=reader, daemon=True).start()
    original_generate = model.model.talker.generate

    class Cancel(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            return cancelled.is_set()

    def generate(*pos, **kwargs):
        kwargs['stopping_criteria'] = StoppingCriteriaList([Cancel()])
        kwargs['do_sample'] = False
        kwargs['subtalker_dosample'] = False
        return original_generate(*pos, **kwargs)

    model.model.talker.generate = generate
    emit({'ready': True, 'provider': 'qwen', 'sampleRate': 24000, 'emotionSupported': model.model.tts_model_size != '0b6'})
    while True:
        command = commands.get()
        if command is None:
            break
        cancelled.clear()
        frames = []
        emitted = 0
        started = time.perf_counter()

        def chunk(pcm):
            data = (np.clip(pcm, -1, 1)*32767).astype('<i2').tobytes()
            emit({'id': command['id'], 'pcm': base64.b64encode(data).decode('ascii'),
                  'atMs': (time.perf_counter()-started)*1000})

        def capture(_module, _args, result):
            nonlocal emitted
            codes = result.hidden_states[-1]
            if cancelled.is_set() or codes is None or int(codes[0, 0]) == model.model.config.talker_config.codec_eos_token_id:
                return
            frames.append(codes.detach())
            if len(frames) % 6 == 0:
                prefix = torch.stack(frames, dim=1)[0]
                with torch.inference_mode():
                    wavs, sr = model.model.speech_tokenizer.decode([{'audio_codes': prefix}])
                pcm = np.asarray(wavs[0], dtype=np.float32)
                safe = max(0, len(pcm)-int(sr/6))
                if safe > emitted and not cancelled.is_set():
                    chunk(pcm[emitted:safe])
                    emitted = safe

        hook = model.model.talker.register_forward_hook(capture)
        try:
            wavs, sr = model.generate_custom_voice(text=command['text'], language='Chinese',
                                                  speaker=command.get('speaker', 'Serena'),
                                                  instruct=command.get('instruct', '') or None)
            if not cancelled.is_set():
                pcm = np.asarray(wavs[0], dtype=np.float32)
                if len(pcm) > emitted:
                    chunk(pcm[emitted:])
            emit({'id': command['id'], 'done': True, 'cancelled': cancelled.is_set(),
                  'elapsedMs': (time.perf_counter()-started)*1000})
        except Exception as error:
            import traceback
            traceback.print_exc()
            emit({'id': command['id'], 'error': type(error).__name__, 'detail': str(error), 'done': True})
        finally:
            hook.remove()


if __name__ == '__main__':
    main()
