#!/usr/bin/env python3
"""
Test script for PDF verification
"""

import sys
import os
sys.path.append(os.path.dirname(__file__))

from verify_pdf import verify_pdf_document

def create_test_pdf():
    """Create a test PDF with the expected content for testing."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import letter
    
    filename = "test_document.pdf"
    c = canvas.Canvas(filename, pagesize=letter)
    
    # Add test content
    c.drawString(100, 750, "UNIVERSIDADE ESTADUAL PAULISTA")
    c.drawString(100, 730, "Documento emitido às 22:11 do dia 02/08/2025")
    c.drawString(100, 710, "Código de autenticidade:")
    c.drawString(100, 690, "5532-5403-026B-302B-CB37-2FE5-8CD5-FF95")
    c.drawString(100, 670, "Documento válido até às 22:11 do dia 29/01/2026")
    c.drawString(100, 650, "")
    c.drawString(100, 630, "Este é um documento de teste para verificação do sistema.")
    
    c.save()
    return filename

def test_pdf_verification():
    """Test the PDF verification with a sample document."""
    print("Creating test PDF...")
    test_file = create_test_pdf()
    
    try:
        print(f"Testing PDF verification with: {test_file}")
        result = verify_pdf_document(test_file)
        
        print("Verification result:")
        print(f"Success: {result['success']}")
        
        if result['success'] and result['data']:
            data = result['data']
            print(f"Document valid: {data['isValid']}")
            print(f"Auth code: {data.get('authCode')}")
            print(f"Emission date: {data.get('emissionDate')}")
            print(f"Expiration date: {data.get('expirationDate')}")
            if data.get('error'):
                print(f"Error: {data['error']}")
        elif not result['success']:
            print(f"Error: {result.get('error')}")
            
    finally:
        # Clean up test file
        if os.path.exists(test_file):
            os.remove(test_file)
            print(f"Cleaned up test file: {test_file}")

if __name__ == "__main__":
    test_pdf_verification()
