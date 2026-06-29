#!/usr/bin/env python3

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
except ModuleNotFoundError:
    letter = None
    canvas = None

try:
    import verify_pdf
except ModuleNotFoundError as error:
    if error.name != "pypdf":
        raise
    verify_pdf = None


AUTH_CODE = "5532-5403-026B-302B-CB37-2FE5-8CD5-FF95"


def build_document_text(expiration_date="31/12/2999"):
    return "\n".join(
        [
            "UNIVERSIDADE ESTADUAL PAULISTA",
            "Documento emitido às 22:11 do dia 02/08/2025",
            "Código de autenticidade:",
            AUTH_CODE,
            f"Documento válido até às 23:59 do dia {expiration_date}",
        ]
    )


def write_pdf(path, text):
    if canvas is None or letter is None:
        raise RuntimeError("reportlab is required to write test PDFs")

    pdf = canvas.Canvas(str(path), pagesize=letter)
    y = 750

    for line in text.splitlines():
        pdf.drawString(100, y, line)
        y -= 20

    pdf.save()


@unittest.skipIf(verify_pdf is None, "pypdf is not installed")
class VerifyPdfTest(unittest.TestCase):
    def test_parse_valid_document_info(self):
        result = verify_pdf.parse_document_info(build_document_text())

        self.assertTrue(result["isValid"])
        self.assertEqual(result["authCode"], AUTH_CODE)
        self.assertEqual(result["emissionDate"], "2025-08-02T22:11:00+00:00")
        self.assertEqual(result["expirationDate"], "2999-12-31T23:59:00+00:00")
        self.assertIsNone(result["error"])

    def test_parse_expired_document_info(self):
        result = verify_pdf.parse_document_info(
            build_document_text(expiration_date="01/01/2020")
        )

        self.assertFalse(result["isValid"])
        self.assertEqual(
            result["error"], "Documento expirado. Válido até 01/01/2020 às 23:59"
        )

    def test_parse_missing_fields_short_circuits_with_specific_errors(self):
        self.assertEqual(
            verify_pdf.parse_document_info("sem data")["error"],
            "Data de emissão não encontrada no documento",
        )
        self.assertEqual(
            verify_pdf.parse_document_info(
                "Documento emitido às 22:11 do dia 02/08/2025"
            )["error"],
            "Código de autenticidade não encontrado no documento",
        )
        self.assertEqual(
            verify_pdf.parse_document_info(
                "\n".join(
                    [
                        "Documento emitido às 22:11 do dia 02/08/2025",
                        "Código de autenticidade:",
                        AUTH_CODE,
                    ]
                )
            )["error"],
            "Data de validade não encontrada no documento",
        )

    def test_verify_pdf_document_reads_pdf_file(self):
        if canvas is None:
            self.skipTest("reportlab is not installed")

        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "document.pdf"
            write_pdf(pdf_path, build_document_text())

            result = verify_pdf.verify_pdf_document(str(pdf_path))

        self.assertTrue(result["success"])
        self.assertTrue(result["data"]["isValid"])
        self.assertEqual(result["data"]["authCode"], AUTH_CODE)

    def test_verify_pdf_document_returns_error_for_unreadable_pdf(self):
        result = verify_pdf.verify_pdf_document("/tmp/arquivo-inexistente.pdf")

        self.assertFalse(result["success"])
        self.assertIn("Erro ao ler PDF", result["error"])
        self.assertIsNone(result["data"])

    def test_main_prints_json_usage_error(self):
        stdout = io.StringIO()

        with (
            redirect_stdout(stdout),
            patch.object(verify_pdf.sys, "argv", ["verify_pdf.py"]),
            self.assertRaises(SystemExit) as exit_context,
        ):
            verify_pdf.main()

        self.assertEqual(exit_context.exception.code, 1)
        self.assertIn('"success": false', stdout.getvalue())
        self.assertIn("Usage: python verify_pdf.py <pdf_file_path>", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
