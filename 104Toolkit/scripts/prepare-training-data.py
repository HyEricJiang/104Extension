"""將 v1.8.0 訓練 PDF 拆為不含標註的模型輸入與獨立答案；不連線或訓練模型。"""
import argparse
import json
import unicodedata
from pathlib import Path
from pypdf import PdfReader, PdfWriter


def split_training_pdf(source, destination):
    reader = PdfReader(source)
    try:
        annotation = json.loads((reader.metadata or {}).get('/Subject', ''))
    except (ValueError, TypeError):
        raise ValueError('缺少可辨識的標註資訊，請使用 v1.8.0 重新匯出。')
    count = annotation.get('annotationPages')
    if annotation.get('schema') != '104-training-v1' or type(count) is not int or not 0 < count < len(reader.pages):
        raise ValueError('標註頁數不正確，未將檔案當作訓練資料。')
    if not isinstance(annotation.get('label'), str) or not isinstance(annotation.get('reason'), str):
        raise ValueError('缺少人工標籤或原因欄位。')
    pages = list(reader.pages)[count:]
    text = unicodedata.normalize('NFKC', '\n\n'.join(page.extract_text() or '' for page in pages)).strip()
    if not text:
        raise ValueError('原始履歷無可擷取文字，請先完成 OCR 再準備訓練資料。')
    destination.mkdir(parents=True, exist_ok=False)
    writer = PdfWriter()
    for page in pages:
        writer.add_page(page)
    # 不複製訓練 PDF 的 Subject，避免答案由中繼資料漏進模型輸入。
    writer.add_metadata({'/Title': '履歷輸入'})
    with (destination / 'input.pdf').open('wb') as output:
        writer.write(output)
    (destination / 'input.txt').write_text(text, encoding='utf-8')
    expected = {'label': annotation['label'], 'reason': annotation['reason']}
    (destination / 'expected.json').write_text(json.dumps(expected, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'input': {'resume_text': text}, 'expected': expected}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='訓練 PDF 或包含訓練 PDF 的資料夾')
    parser.add_argument('--output', required=True, type=Path, help='新的輸出資料夾，不可覆蓋既有資料')
    args = parser.parse_args()
    sources = sorted(args.source.glob('AI訓練資料_*.pdf')) if args.source.is_dir() else [args.source]
    if not sources:
        parser.error('找不到 AI 訓練資料 PDF。')
    if args.output.exists():
        parser.error('輸出資料夾已存在，請指定新的資料夾。')
    args.output.mkdir(parents=True)
    rows, failures = [], []
    for index, source in enumerate(sources, 1):
        try:
            rows.append(split_training_pdf(source, args.output / f'sample-{index:05d}'))
        except Exception as error:
            failures.append({'file': source.name, 'error': str(error)})
    (args.output / 'dataset.jsonl').write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding='utf-8')
    (args.output / 'errors.json').write_text(json.dumps(failures, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'已分離 {len(rows)} 份，失敗 {len(failures)} 份。僅將 input.pdf 或 input.txt 作為模型輸入；expected.json 是評分／訓練答案。')
    if failures:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
