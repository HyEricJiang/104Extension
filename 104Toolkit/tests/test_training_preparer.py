import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prep', ROOT / 'scripts/prepare-training-data.py')
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


class TrainingPreparerTests(unittest.TestCase):
    def test_input_has_no_annotations_or_answer_metadata(self):
        source = ROOT / 'docs/examples/AI訓練資料_虛構人才.pdf'
        with tempfile.TemporaryDirectory() as tmp:
            row = prep.split_training_pdf(source, Path(tmp) / 'sample')
            self.assertIn('虛構人才履歷', row['input']['resume_text'])
            self.assertNotIn('模型訓練標註', row['input']['resume_text'])
            self.assertNotIn('錯位原因', row['input']['resume_text'])
            self.assertEqual(row['expected']['label'], '人工審核但需要推薦')
            result = PdfReader(Path(tmp) / 'sample/input.pdf')
            self.assertEqual(len(result.pages), 1)
            self.assertNotIn('104-training-v1', str(result.metadata))
            expected = json.loads((Path(tmp) / 'sample/expected.json').read_text())
            self.assertEqual(expected, row['expected'])

    def test_unannotated_pdf_is_rejected(self):
        from pypdf import PdfWriter
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / 'old.pdf'
            writer = PdfWriter(); writer.add_blank_page(width=595, height=842)
            with pdf.open('wb') as out: writer.write(out)
            with self.assertRaises(ValueError): prep.split_training_pdf(pdf, Path(tmp) / 'out')
            self.assertFalse((Path(tmp) / 'out').exists())


if __name__ == '__main__': unittest.main()
