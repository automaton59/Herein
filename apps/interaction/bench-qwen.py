"""Isolated benchmark; never edits the installed Qwen package or existing services."""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(4)
    start = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(args.model, device_map='cuda:0', dtype=torch.bfloat16,
                                         attn_implementation='sdpa', local_files_only=True)
    print(json.dumps({'loadMs': (time.perf_counter()-start)*1000}), flush=True)
    original_generate = model.model.talker.generate
    frames = []
    observations = []
    started = 0
    emitted = 0

    def capture(_module, _args, result):
        nonlocal emitted
        codes = result.hidden_states[-1]
        if codes is None or int(codes[0, 0]) == model.model.config.talker_config.codec_eos_token_id:
            return
        frames.append(codes.detach())
        if len(frames) % 6 == 0:
            prefix = torch.stack(frames, dim=1)[0]
            before = time.perf_counter()
            with torch.inference_mode():
                wavs, sr = model.model.speech_tokenizer.decode([{'audio_codes': prefix}])
            pcm = np.asarray(wavs[0], dtype=np.float32)
            safe = max(0, len(pcm)-int(sr/6))
            if safe > emitted:
                observations.append({'frames': len(frames), 'atMs': (time.perf_counter()-started)*1000,
                                     'decodeMs': (time.perf_counter()-before)*1000, 'newSamples': safe-emitted})
                emitted = safe

    # Qwen's wrapper drops stopping criteria; injection is scoped to this benchmark process.
    def generate(*pos, **kwargs):
        kwargs['do_sample'] = False
        kwargs['subtalker_dosample'] = False
        return original_generate(*pos, **kwargs)

    model.model.talker.generate = generate
    hook = model.model.talker.register_forward_hook(capture)
    reports = []
    for run, text in enumerate(['你好。', '嗯，我在。', '别急，慢慢说。']):
        frames.clear()
        observations.clear()
        emitted = 0
        started = time.perf_counter()
        wavs, sr = model.generate_custom_voice(text=text, language='Chinese', speaker='Serena', max_new_tokens=256)
        elapsed = time.perf_counter()-started
        sf.write(output / f'qwen-{run}.wav', wavs[0], sr)
        report = {'run': run, 'elapsedMs': elapsed*1000, 'audioSeconds': len(wavs[0])/sr,
                  'rtf': elapsed/(len(wavs[0])/sr), 'chunks': list(observations),
                  'vramMiB': torch.cuda.max_memory_allocated()/1048576}
        reports.append(report)
        print(json.dumps(report), flush=True)
    hook.remove()
    (output / 'qwen-stream-probe.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
