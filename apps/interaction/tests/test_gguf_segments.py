"""No models required; long input must never disappear at a chunk boundary."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('gguf_worker', Path(__file__).parents[1] / 'gguf-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SpeechSegmentsTest(unittest.TestCase):
    def test_long_sentence_without_punctuation_preserves_every_character(self):
        text = '蓝' * 499 + '鱼'
        chunks = worker.speech_segments(text)
        self.assertEqual(''.join(chunks), text)
        self.assertEqual(chunks[-1][-1], '鱼')
        self.assertTrue(all(0 < len(chunk) <= 60 for chunk in chunks))

    def test_prefers_sentences_and_nearby_clause_boundaries(self):
        text = '先喝一点水。' + '蓝' * 35 + '，' + '鱼' * 45 + '！最后一句保留。'
        chunks = worker.speech_segments(text)
        self.assertEqual(chunks[0], '先喝一点水。')
        self.assertTrue(chunks[1].endswith('，'))
        self.assertEqual(chunks[-1], '最后一句保留。')
        self.assertEqual(''.join(chunks), text)
        self.assertTrue(all(len(chunk) <= 60 for chunk in chunks))

    def test_keeps_unicode_and_spaces(self):
        text = ('  蓝鱼🐟\nHello! ' * 30) + '尾声。'
        self.assertEqual(''.join(worker.speech_segments(text)), text)


if __name__ == '__main__':
    unittest.main()
