#!/usr/bin/env python3
import sys
from pypdf import PdfReader

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF file"""
    try:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PdfReader(file)
            text = ''
            
            for page in pdf_reader.pages:
                text += page.extract_text() or ""
            
            return text
    except Exception as e:
        print(f"Error extracting text from PDF: {e}", file=sys.stderr)
        return ""

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 extract_pdf_text.py <pdf_file>", file=sys.stderr)
        sys.exit(1)
    
    pdf_file = sys.argv[1]
    extracted_text = extract_text_from_pdf(pdf_file)
    print(extracted_text)
