#!/usr/bin/env python3
"""
PDF Document Verification Script

This script extracts and verifies information from student PDF documents,
specifically looking for authentication codes and validity dates.
"""

import sys
import json
import re
from datetime import datetime, timezone
from typing import Dict, Optional, Any
from pypdf import PdfReader

def extract_text_from_pdf(pdf_path: str) -> str:
    """Extract text content from PDF file."""
    try:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PdfReader(file)
            text = ""
            for page in pdf_reader.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    text += page_text + "\n"
            return text
    except Exception as e:
        raise Exception(f"Erro ao ler PDF: {str(e)}")

def parse_document_info(text: str) -> Dict[str, Any]:
    """
    Parse document information from extracted text.
    
    Expected format:
    Documento emitido às 00:00 do dia 01/01/2025
    Código de autenticidade:
    AAAA-BBBB-CCCC-DDDD-1111-2222-3333-4444
    Documento válido até às 00:00 do dia 01/01/2026
    """
    result = {
        "isValid": False,
        "authCode": None,
        "emissionDate": None,
        "expirationDate": None,
        "error": None
    }
    
    try:
        # Pattern for emission date
        emission_pattern = r"Documento emitido às (\d{2}:\d{2}) do dia (\d{2}/\d{2}/\d{4})"
        emission_match = re.search(emission_pattern, text)
        
        # Pattern for authentication code (UUID-like format)
        auth_code_pattern = r"Código de autenticidade:\s*([A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4})"
        auth_code_match = re.search(auth_code_pattern, text, re.IGNORECASE)
        
        # Pattern for expiration date
        expiration_pattern = r"Documento válido até às (\d{2}:\d{2}) do dia (\d{2}/\d{2}/\d{4})"
        expiration_match = re.search(expiration_pattern, text)
        
        if not emission_match:
            result["error"] = "Data de emissão não encontrada no documento"
            return result
            
        if not auth_code_match:
            result["error"] = "Código de autenticidade não encontrado no documento"
            return result
            
        if not expiration_match:
            result["error"] = "Data de validade não encontrada no documento"
            return result
        
        # Parse dates
        emission_time = emission_match.group(1)
        emission_date = emission_match.group(2)
        emission_datetime_str = f"{emission_date} {emission_time}"
        emission_datetime = datetime.strptime(emission_datetime_str, "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
        
        expiration_time = expiration_match.group(1)
        expiration_date = expiration_match.group(2)
        expiration_datetime_str = f"{expiration_date} {expiration_time}"
        expiration_datetime = datetime.strptime(expiration_datetime_str, "%d/%m/%Y %H:%M").replace(tzinfo=timezone.utc)
        
        # Get authentication code
        auth_code = auth_code_match.group(1)
        
        # Check if document is still valid
        current_time = datetime.now(timezone.utc)
        is_valid = current_time <= expiration_datetime
        
        result.update({
            "isValid": is_valid,
            "authCode": auth_code,
            "emissionDate": emission_datetime.isoformat(),
            "expirationDate": expiration_datetime.isoformat(),
            "currentDate": current_time.isoformat()
        })
        
        if not is_valid:
            result["error"] = f"Documento expirado. Válido até {expiration_datetime.strftime('%d/%m/%Y às %H:%M')}"
        
    except Exception as e:
        result["error"] = f"Erro ao processar documento: {str(e)}"
    
    return result

def verify_pdf_document(pdf_path: str) -> Dict[str, Any]:
    """Main function to verify PDF document."""
    try:
        # Extract text from PDF
        text = extract_text_from_pdf(pdf_path)
        
        # Parse document information
        document_info = parse_document_info(text)
        
        return {
            "success": True,
            "data": document_info
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "data": None
        }

def main():
    """Main entry point for command line usage."""
    if len(sys.argv) != 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python verify_pdf.py <pdf_file_path>"
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    result = verify_pdf_document(pdf_path)
    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
