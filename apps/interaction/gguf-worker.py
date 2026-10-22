"""Private local Qwen3-TTS-GGUF adapter. No models or upstream files are bundled.

Tested upstream commit: 74feb581bc8cefb835fc608107e857036d7580a1 (MIT).
llama.cpp b10621 supplies a separate licensed local backend. Requests and PCM
remain in memory; upstream file logging is disabled before its package import.
"""
import argparse
import base64
import contextlib
import json
import logging
import os
import queue
import sys
import threading
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--dependencies', default='')
    parser.add_argument('--provider', choices=['DML', 'CUDA', 'CPU'], default='DML')
    parser.add_argument('--cuda-bin', default='')
    args = parser.parse_args()
    sys.path.insert(0, args.source)
    if args.dependencies:
        for entry in reversed(args.dependencies.split(os.pathsep)):
            sys.path.insert(0, entry)
    dll_handles = []
    if args.cuda_bin and hasattr(os, 'add_dll_directory'):
        dll_handles.append(os.add_dll_directory(args.cuda_bin))
    logger = logging.getLogger('qwen3_tts_gguf')
    logger.addHandler(logging.NullHandler())
    logger.propagate = False
    import numpy as np
    import onnxruntime as ort
    from qwen3_tts_gguf.inference import TTSEngine, TTSConfig

    original_session = ort.InferenceSession

    def session(model_path, sess_options=None, **kwargs):
        sess_options.intra_op_num_threads = 4
        sess_options.inter_op_num_threads = 1
        if args.provider == 'DML':
            sess_options.enable_mem_pattern = False
        return original_session(model_path, sess_options=sess_options, **kwargs)

    ort.InferenceSession = session
    with contextlib.redirect_stdout(sys.stderr):
        engine = TTSEngine(args.model, onnx_provider=args.provider, llm_use_gpu=True,
                           chunk_size=6, subprocess_decoder=False, verbose=False)
        if not engine.ready:
            raise RuntimeError('GGUF engine unavailable')
        active_provider = engine.decoder._dec.active_provider
        if args.provider != 'CPU' and active_provider == 'CPUExecutionProvider':
            raise RuntimeError('Requested GPU decoder unavailable')
        stream = engine.create_stream(n_ctx=2048)
        # Silent, fixed fixtures warm Vulkan kernels and decoder shapes, never user text.
        for fixture in ['你好。', '别急，慢慢说。', '你今天怎么这么晚。', '嗯，我在。']:
            result = stream.custom(fixture, speaker='Serena', language='chinese',
                                   config=TTSConfig(streaming=True, max_steps=120, seed=42, sub_seed=42))
            if result is None:
                raise RuntimeError('GGUF warmup failed')

    commands = queue.Queue(maxsize=1)
    cancelled = threading.Event()
    output_lock = threading.Lock()
    protocol_out = sys.stdout

    def emit(value):
        with output_lock:
            protocol_out.write(json.dumps(value) + '\n')
            protocol_out.flush()

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

    original_loop = stream._run_engine_loop_gen

    class Cancelled(Exception):
        pass

    def loop(*a, **k):
        generator = original_loop(*a, **k)
        try:
            for item in generator:
                if cancelled.is_set():
                    raise Cancelled()
                yield item
        finally:
            generator.close()

    stream._run_engine_loop_gen = loop
    original_decode = engine.decoder._dec.decode
    command = None
    started = 0

    def decode(*a, **k):
        if cancelled.is_set():
            raise Cancelled()
        audio, state = original_decode(*a, **k)
        if len(audio) and not cancelled.is_set():
            data = (np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes()
            emit({'id': command['id'], 'pcm': base64.b64encode(data).decode('ascii'),
                  'atMs': (time.perf_counter() - started) * 1000})
        return audio, state

    engine.decoder._dec.decode = decode
    threading.Thread(target=reader, daemon=True).start()
    emit({'ready': True, 'provider': 'qwen-gguf', 'sampleRate': 24000,
          'decoder': active_provider})
    try:
        while True:
            command = commands.get()
            if command is None:
                break
            cancelled.clear()
            started = time.perf_counter()
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    result = stream.custom(command['text'], speaker=command.get('speaker', 'Serena'),
                                           language='chinese', instruct=command.get('instruct', ''),
                                           config=TTSConfig(streaming=True, max_steps=300, seed=42, sub_seed=42))
                if result is None and not cancelled.is_set():
                    raise RuntimeError('synthesis_failed')
                emit({'id': command['id'], 'done': True, 'cancelled': cancelled.is_set(),
                      'elapsedMs': (time.perf_counter() - started) * 1000})
            except Exception as error:
                emit({'id': command['id'], 'done': True,
                      'error': type(error).__name__ if not cancelled.is_set() else None})
            finally:
                engine.decoder.sessions.clear()
                engine.decoder._bank.clear()
    finally:
        stream.shutdown()
        engine.shutdown()


if __name__ == '__main__':
    main()
