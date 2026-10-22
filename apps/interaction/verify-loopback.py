"""Record only a generated fixture on the speaker loopback for playback QA.

Run with the microphone paused. This never selects the physical microphone.
The recording is kept in memory; only thresholds/timestamps are written.
"""
import argparse
import json
import sys
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--tools', required=True)
    args = parser.parse_args()
    sys.path.insert(0, args.tools)
    import soundcard as sc
    endpoint = json.loads((Path(args.data)/'endpoint.local.json').read_text())

    def post(route, value):
        body = json.dumps(value).encode()
        request = Request(endpoint['url']+route, data=body, headers={'Authorization': 'Bearer '+endpoint['token'], 'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            return json.load(response)

    post('/v1/listening', {'enabled': False})
    speaker = sc.default_speaker()
    loopback = sc.get_microphone(id=speaker.id, include_loopback=True)
    assert loopback.isloopback
    recorded = []
    stop = threading.Event()
    ready = threading.Event()

    def record():
        with loopback.recorder(samplerate=24000, channels=2, blocksize=480) as recorder:
            ready.set()
            while not stop.is_set():
                samples = recorder.record(numframes=480)
                recorded.append((time.perf_counter(), float(np.sqrt(np.mean(samples*samples)))))

    thread = threading.Thread(target=record)
    thread.start()
    ready.wait(10)
    time.sleep(.3)
    start = time.perf_counter()
    post('/v1/speech', {'text': '这是一段用来测量扬声器打断的测试声音，播放时会停止，随后不应该继续出声。'})
    first = None
    for _ in range(150):
        first = next((at for at, level in recorded if at >= start and level > .004), None)
        if first:
            break
        time.sleep(.02)
    time.sleep(.5)
    cancelled = time.perf_counter()
    post('/v1/cancel', {})
    time.sleep(2)
    stop.set()
    thread.join(5)
    after = [(at,level) for at,level in recorded if at >= cancelled]
    last = max((at for at,level in after if level > .004), default=cancelled)
    report = {'loopbackOnly': True, 'firstMs': (first-start)*1000 if first else None,
              'cancelToLastSoundMs': (last-cancelled)*1000, 'peakRmsAfter500ms': max((level for at,level in after if at>cancelled+.5), default=0),
              'sampleCount': len(recorded)}
    (Path(args.data)/'loopback-verification.local.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report), flush=True)
    assert first is not None, 'No generated fixture detected at speaker loopback'
    assert report['cancelToLastSoundMs'] < 200, 'Speaker stop exceeded 200ms'
    assert report['peakRmsAfter500ms'] < .004, 'Audio continued after cancellation'
    post('/v1/listening', {'enabled': True})


if __name__ == '__main__':
    main()
