import { Injectable } from '@angular/core';
import {
  CountryCode,
  AsYouType,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

export interface ParsedPhoneValue {
  country: CountryCode;
  nationalNumber: string;
  e164: string;
}

@Injectable({
  providedIn: 'root',
})
export class PhoneValidationService {
  // Parse phone string into country, national number, and E.164.
  private normalizeCountryCode(countryCode: string): CountryCode {
    return isSupportedCountry(countryCode) ? countryCode : 'BR';
  }

  parsePhoneValue(
    phone: string,
    defaultCountry: string = 'BR',
  ): ParsedPhoneValue {
    const normalizedCountry = this.normalizeCountryCode(defaultCountry);
    const cleaned = phone?.trim() || '';

    const parsed =
      parsePhoneNumberFromString(cleaned) ||
      parsePhoneNumberFromString(cleaned, normalizedCountry);

    if (parsed) {
      return {
        country: parsed.country || normalizedCountry,
        nationalNumber: parsed.nationalNumber,
        e164: parsed.number || '',
      };
    }

    const digits = cleaned.replace(/\D/g, '');
    return {
      country: normalizedCountry,
      nationalNumber: digits,
      e164: digits
        ? `+${getCountryCallingCode(normalizedCountry)}${digits}`
        : '',
    };
  }

  // Format phone number to E.164 for backend submission.
  formatToInternational(phone: string, countryCode: string = 'BR'): string {
    if (!phone) {
      return '';
    }

    const normalizedCountry = this.normalizeCountryCode(countryCode);
    const parsed = this.parsePhoneValue(phone, normalizedCountry);
    return parsed.e164;
  }

  // Validate international phone number using libphonenumber-js
  isValidInternationalPhone(
    phone: string,
    countryCode: string = 'BR',
  ): boolean {
    if (!phone) {
      return false;
    }

    const normalizedCountry = this.normalizeCountryCode(countryCode);
    const parsed = parsePhoneNumberFromString(phone.trim(), normalizedCountry);
    return parsed?.isValid() ?? false;
  }

  // Validate Brazilian phone number
  isValidBrazilianPhone(phone: string): boolean {
    const cleaned = phone.replace(/\D/g, '');

    // Brazilian mobile: 11 digits (including area code)
    // Brazilian landline: 10 digits (including area code)
    return cleaned.length === 10 || cleaned.length === 11;
  }

  // Format phone number using the national formatting rules for the selected country.
  formatToNational(phone: string, countryCode: string = 'BR'): string {
    if (!phone) {
      return '';
    }

    const normalizedCountry = this.normalizeCountryCode(countryCode);
    const parsed =
      parsePhoneNumberFromString(phone.trim()) ||
      parsePhoneNumberFromString(phone.trim(), normalizedCountry);

    if (parsed?.isValid()) {
      return parsed.formatNational();
    }

    const formatter = new AsYouType(normalizedCountry);
    return formatter.input(phone);
  }

  // Format for display (with masks)
  formatForDisplay(phone: string): string {
    if (!phone) {
      return '';
    }

    const formatter = new AsYouType();
    formatter.input(phone);
    return formatter.getNumberValue() || phone;
  }

  // Validate CPF
  isValidCPF(cpf: string): boolean {
    const cleaned = cpf.replace(/\D/g, '');

    if (cleaned.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cleaned)) return false; // All same digits

    // CPF validation algorithm
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cleaned.charAt(i)) * (10 - i);
    }
    let remainder = 11 - (sum % 11);
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cleaned.charAt(9))) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cleaned.charAt(i)) * (11 - i);
    }
    remainder = 11 - (sum % 11);
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(cleaned.charAt(10))) return false;

    return true;
  }

  // Format CPF for display
  formatCPF(cpf: string): string {
    const cleaned = cpf.replace(/\D/g, '');
    if (cleaned.length === 11) {
      return `${cleaned.substring(0, 3)}.${cleaned.substring(3, 6)}.${cleaned.substring(6, 9)}-${cleaned.substring(9)}`;
    }
    return cpf;
  }
}
