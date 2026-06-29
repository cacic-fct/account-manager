#!/usr/bin/env python3

import io
import json
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
    import verify_pdf_buffer
except ModuleNotFoundError as error:
    if error.name != "pypdf":
        raise
    verify_pdf_buffer = None


AUTH_CODE = "5532-5403-026B-302B-CB37-2FE5-8CD5-FF95"


def build_document_text(auth_code=AUTH_CODE, expiration_date="31/12/2999"):
    return "\n".join(
        [
            "Documento emitido às 22:11 do dia 02/08/2025",
            "Código de autenticidade:",
            auth_code,
            f"Documento válido até às 23:59 do dia {expiration_date}",
        ]
    )


def build_pdf_bytes(text):
    if canvas is None or letter is None:
        raise RuntimeError("reportlab is required to build test PDFs")

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    y = 750

    for line in text.splitlines():
        pdf.drawString(100, y, line)
        y -= 20

    pdf.save()
    return buffer.getvalue()


@unittest.skipIf(verify_pdf_buffer is None, "pypdf is not installed")
class VerifyPdfBufferTest(unittest.TestCase):
    def test_parse_valid_document_info(self):
        result = verify_pdf_buffer.parse_document_info(build_document_text())

        self.assertTrue(result["isValid"])
        self.assertEqual(result["authCode"], AUTH_CODE)
        self.assertEqual(result["emissionDate"], "2025-08-02T22:11:00")
        self.assertEqual(result["expirationDate"], "2999-12-31T23:59:00")
        self.assertIsNone(result["error"])

    def test_parse_invalid_auth_code(self):
        result = verify_pdf_buffer.parse_document_info(
            build_document_text(auth_code="INVALIDO")
        )

        self.assertFalse(result["isValid"])
        self.assertEqual(result["error"], "Formato do código de autenticidade inválido")

    def test_parse_expired_document_info(self):
        result = verify_pdf_buffer.parse_document_info(
            build_document_text(expiration_date="01/01/2020")
        )

        self.assertFalse(result["isValid"])
        self.assertEqual(result["error"], "Documento expirado em 01/01/2020 às 23:59")

    def test_verify_pdf_document_buffer_reads_pdf_bytes(self):
        if canvas is None:
            self.skipTest("reportlab is not installed")

        result = verify_pdf_buffer.verify_pdf_document_buffer(
            build_pdf_bytes(build_document_text())
        )

        self.assertTrue(result["success"])
        self.assertTrue(result["data"]["isValid"])
        self.assertEqual(result["data"]["authCode"], AUTH_CODE)

    def test_verify_pdf_document_buffer_rejects_empty_text(self):
        with patch.object(
            verify_pdf_buffer, "extract_text_from_pdf_buffer", return_value=""
        ):
            result = verify_pdf_buffer.verify_pdf_document_buffer(b"%PDF")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "Não foi possível extrair texto do PDF")

    def test_verify_pdf_document_file_reads_pdf_file(self):
        if canvas is None:
            self.skipTest("reportlab is not installed")

        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "document.pdf"
            pdf_path.write_bytes(build_pdf_bytes(build_document_text()))

            result = verify_pdf_buffer.verify_pdf_document_file(str(pdf_path))

        self.assertTrue(result["success"])
        self.assertTrue(result["data"]["isValid"])

    def test_main_prints_json_for_file_argument(self):
        if canvas is None:
            self.skipTest("reportlab is not installed")

        with tempfile.TemporaryDirectory() as temp_dir:
            pdf_path = Path(temp_dir) / "document.pdf"
            pdf_path.write_bytes(build_pdf_bytes(build_document_text()))
            stdout = io.StringIO()

            with (
                redirect_stdout(stdout),
                patch.object(
                    verify_pdf_buffer.sys,
                    "argv",
                    ["verify_pdf_buffer.py", str(pdf_path)],
                ),
            ):
                verify_pdf_buffer.main()

        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["authCode"], AUTH_CODE)

    def test_main_requires_stdin_or_file_argument(self):
        stdout = io.StringIO()

        with (
            redirect_stdout(stdout),
            patch.object(verify_pdf_buffer.sys, "argv", ["verify_pdf_buffer.py"]),
            patch.object(verify_pdf_buffer.sys.stdin, "isatty", return_value=True),
            self.assertRaises(SystemExit) as exit_context,
        ):
            verify_pdf_buffer.main()

        self.assertEqual(exit_context.exception.code, 1)
        self.assertIn("No input provided", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
