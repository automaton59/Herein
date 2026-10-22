from __future__ import annotations

import argparse
import os


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download a HuggingFace model snapshot.")
    parser.add_argument("repo_id")
    parser.add_argument("--local-dir", required=True)
    parser.add_argument("--hf-endpoint", default=os.environ.get("HF_ENDPOINT", ""))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.hf_endpoint:
        os.environ["HF_ENDPOINT"] = args.hf_endpoint

    from huggingface_hub import snapshot_download

    snapshot_download(
        repo_id=args.repo_id,
        local_dir=args.local_dir,
        resume_download=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
