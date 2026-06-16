#!/usr/bin/env python3
"""
PDF Document Verification Script - Buffer Version

This script extracts and verifies information from student PDF documents,
specifically looking for authentication codes and validity dates.
It can accept PDF data from stdin or from a file path.
"""

import sys
import json
import re
import io
from datetime import datetime
from typing import Dict, Optional, Any
from pypdf import PdfReader

def extract_text_from_pdf_buffer(pdf_buffer: bytes) -> str:
    """Extract text content from PDF buffer."""
    try:
        pdf_stream = io.BytesIO(pdf_buffer)
        pdf_reader = PdfReader(pdf_stream)
        text = ""
        for page in pdf_reader.pages:
            page_text = page.extract_text() or ""
            if page_text:
                text += page_text + "\n"
        return text
    except Exception as e:
        raise Exception(f"Erro ao ler PDF: {str(e)}")

def extract_text_from_pdf_file(pdf_path: str) -> str:
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
        
        if emission_match:
            time_str = emission_match.group(1)
            date_str = emission_match.group(2)
            emission_datetime_str = f"{date_str} {time_str}"
            result["emissionDate"] = datetime.strptime(emission_datetime_str, "%d/%m/%Y %H:%M").isoformat()
        
        # Pattern for authentication code
        auth_pattern = r"Código de autenticidade:\s*([A-Z0-9\-]+)"
        auth_match = re.search(auth_pattern, text)
        
        if auth_match:
            result["authCode"] = auth_match.group(1).strip()
        
        # Pattern for expiration date
        expiration_pattern = r"Documento válido até às (\d{2}:\d{2}) do dia (\d{2}/\d{2}/\d{4})"
        expiration_match = re.search(expiration_pattern, text)
        
        if expiration_match:
            time_str = expiration_match.group(1)
            date_str = expiration_match.group(2)
            expiration_datetime_str = f"{date_str} {time_str}"
            expiration_date = datetime.strptime(expiration_datetime_str, "%d/%m/%Y %H:%M")
            result["expirationDate"] = expiration_date.isoformat()
            
            # Check if document is still valid
            current_date = datetime.now()
            result["isValid"] = current_date <= expiration_date
            
            if not result["isValid"]:
                result["error"] = f"Documento expirado em {expiration_date.strftime('%d/%m/%Y às %H:%M')}"
        else:
            result["error"] = "Data de validade não encontrada no documento"
        
        # Validate authentication code format
        if result["authCode"]:
            # Expected format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
            if not re.match(r'^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$', result["authCode"]):
                result["error"] = "Formato do código de autenticidade inválido"
                result["isValid"] = False
        else:
            result["error"] = "Código de autenticidade não encontrado"
            result["isValid"] = False
    
    except Exception as e:
        result["error"] = f"Erro ao processar documento: {str(e)}"
        result["isValid"] = False
    
    return result

def verify_pdf_document_buffer(pdf_buffer: bytes) -> Dict[str, Any]:
    """Verify PDF document from buffer."""
    try:
        text = extract_text_from_pdf_buffer(pdf_buffer)
        if not text.strip():
            return {
                "success": False,
                "error": "Não foi possível extrair texto do PDF"
            }
        
        document_info = parse_document_info(text)
        
        return {
            "success": True,
            "data": document_info
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def verify_pdf_document_file(pdf_path: str) -> Dict[str, Any]:
    """Verify PDF document from file path."""
    try:
        text = extract_text_from_pdf_file(pdf_path)
        if not text.strip():
            return {
                "success": False,
                "error": "Não foi possível extrair texto do PDF"
            }
        
        document_info = parse_document_info(text)
        
        return {
            "success": True,
            "data": document_info
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    """Main function - handles both stdin buffer and file path input."""
    if len(sys.argv) > 1:
        # File path provided as argument
        pdf_path = sys.argv[1]
        result = verify_pdf_document_file(pdf_path)
    else:
        # Read from stdin
        if sys.stdin.isatty():
            print(json.dumps({
                "success": False,
                "error": "No input provided. Use: python verify_pdf_buffer.py <file_path> or pipe PDF data to stdin"
            }))
            sys.exit(1)
        
        try:
            # Read binary data from stdin
            pdf_buffer = sys.stdin.buffer.read()
            if not pdf_buffer:
                print(json.dumps({
                    "success": False,
                    "error": "No PDF data received from stdin"
                }))
                sys.exit(1)
            
            result = verify_pdf_document_buffer(pdf_buffer)
        except Exception as e:
            result = {
                "success": False,
                "error": f"Error reading from stdin: {str(e)}"
            }
    
    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
