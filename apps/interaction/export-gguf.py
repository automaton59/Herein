"""Export an existing private 0.6B CustomVoice model using a local GGUF checkout.

Requires torch, safetensors, numpy, gguf, transformers, onnx, onnxscript,
onnxruntime-directml, sentencepiece. No network access or installation performed.
Upstream: HaujetZhao/Qwen3-TTS-GGUF, commit
74feb581bc8cefb835fc608107e857036d7580a1. Follow upstream and model licenses.
"""
import argparse
import runpy
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--dependencies', default='')
    parser.add_argument('--resume-decoder', action='store_true')
    args = parser.parse_args()
    import os
    source, model, output = (Path(value).resolve() for value in (args.source, args.model, args.output))
    if output == model or model in output.parents or output == source or source in output.parents:
        raise ValueError('Export output must be separate from model and source')
    if not args.resume_decoder and output.exists() and any(output.iterdir()):
        raise ValueError('Output must be empty; use --resume-decoder only for an existing export')
    sys.path.insert(0, str(source))
    for entry in reversed(args.dependencies.split(os.pathsep)):
        if entry:
            sys.path.insert(0, entry)
    import export_config
    export_config.MODEL_DIR = model
    export_config.EXPORT_DIR = output
    output.mkdir(parents=True, exist_ok=True)
    if not args.resume_decoder:
        import torch
        import numpy as np
        from safetensors import safe_open
        torch.set_num_threads(4)
        embeddings = output / 'embeddings'
        embeddings.mkdir(exist_ok=True)
        with safe_open(str(model / 'model.safetensors'), framework='pt', device='cpu') as weights:
            table = weights.get_tensor('talker.model.text_embedding.weight')
            w1 = weights.get_tensor('talker.text_projection.linear_fc1.weight').cuda()
            b1 = weights.get_tensor('talker.text_projection.linear_fc1.bias').cuda()
            w2 = weights.get_tensor('talker.text_projection.linear_fc2.weight').cuda()
            b2 = weights.get_tensor('talker.text_projection.linear_fc2.bias').cuda()
            projected = np.lib.format.open_memmap(embeddings / 'text_embedding_projected.npy',
                                                 mode='w+', dtype=np.float16, shape=(len(table), len(b2)))
            with torch.inference_mode():
                for offset in range(0, len(table), 2048):
                    raw = table[offset:offset + 2048].cuda()
                    block = torch.nn.functional.linear(torch.nn.functional.silu(
                        torch.nn.functional.linear(raw, w1, b1)), w2, b2)
                    projected[offset:offset + len(raw)] = block.float().cpu().numpy().astype(np.float16)
            del projected, table, w1, b1, w2, b2
            np.save(embeddings / 'codec_embedding_0.npy', weights.get_tensor('talker.model.codec_embedding.weight').float().numpy())
            for index in range(15):
                np.save(embeddings / f'codec_embedding_{index+1}.npy', weights.get_tensor(
                    f'talker.code_predictor.model.codec_embedding.{index}.weight').float().numpy())
        torch.cuda.empty_cache()
    scripts = ['15-Copy-Tokenizer.py', '21-Extract-Talker-Weights.py', '22-Prepare-Talker-Tokenizer.py',
               '23-Convert-Talker-GGUF.py', '24-Quantize-Talker-GGUF.py', '31-Extract-Predictor-Weights.py',
               '32-Prepare-Predictor-Tokenizer.py', '33-Convert-Predictor-GGUF.py', '34-Quantize-Predictor-GGUF.py',
               '13-Export-Decoder.py', '16-Quantize-ONNX-Models.py']
    if args.resume_decoder:
        scripts = scripts[scripts.index('13-Export-Decoder.py'):]
    for name in scripts:
        print('RUN', name, flush=True)
        runpy.run_path(str(source / name), run_name='__main__')


if __name__ == '__main__':
    main()
