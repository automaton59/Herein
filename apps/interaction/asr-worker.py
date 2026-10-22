"""Persistent offline ASR worker. Audio stays in memory and requests are serial."""
import argparse
import base64
import json
import sys
import time

import numpy as np
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--device', default='cpu')
    args = parser.parse_args()
    started = time.perf_counter()
    model = WhisperModel(args.model, device=args.device, compute_type='int8' if args.device == 'cpu' else 'int8_float16',
                         cpu_threads=4, num_workers=1, local_files_only=True)
    print(json.dumps({'ready': True, 'loadMs': (time.perf_counter()-started)*1000}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            audio = np.frombuffer(base64.b64decode(request['pcm']), dtype='<i2').astype(np.float32)/32768
            started = time.perf_counter()
            segments, _info = model.transcribe(audio, language='zh', beam_size=1, vad_filter=True,
                                               condition_on_previous_text=False, temperature=0)
            text = ''.join(segment.text for segment in segments).strip()
            print(json.dumps({'id': request['id'], 'text': text, 'elapsedMs': (time.perf_counter()-started)*1000}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({'id': request.get('id'), 'error': type(error).__name__}), flush=True)


if __name__ == '__main__':
    main()
