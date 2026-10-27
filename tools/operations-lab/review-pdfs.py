"""Optional local visual QA. Requires PyMuPDF; never changes PDFs or DB records."""
import json
from pathlib import Path
import pymupdf

root = Path("artifacts/operations-lab")
out = root / "pdf-review"
out.mkdir(exist_ok=True)
rows = []
for pdf in sorted((root / "receipts").glob("*.pdf")):
    document = pymupdf.open(pdf)
    text = "\n".join(page.get_text() for page in document)
    for label in ("SIMULATED TEST ONLY", "NOT FISCAL", "NOT VALID CUSTOMER RECEIPT"):
        assert label in text, (pdf.name, label)
    for index, page in enumerate(document):
        page.get_pixmap(matrix=pymupdf.Matrix(2, 2)).save(
            str(out / (pdf.stem + "-" + str(index + 1) + ".png"))
        )
    rows.append({"file": pdf.name, "pages": len(document), "watermarks": True})
(out / "manifest.json").write_text(json.dumps(rows, indent=2), encoding="utf8")
print(json.dumps(rows))
