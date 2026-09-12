import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import { errorReportCsv, normalizeRows, parseSpreadsheet, suggestMapping } from '../src/importer/service.js';

describe('portfolio importer parsing and normalization', () => {
  it('parses quoted CSV values, commas, blank rows, and common line endings', () => {
    const parsed = parseSpreadsheet(Buffer.from('Building,Apt #,Tenant Name,Email,Start Date,Monthly\r\n"Oak, Court",2A,"Rivera, Jamie",jamie@example.com,9/1/2026,"$1,850.00"\r\n\r\n'), 'portfolio.csv');
    expect(parsed.headers).toEqual(['Building', 'Apt #', 'Tenant Name', 'Email', 'Start Date', 'Monthly']);
    expect(parsed.rows[0]!['Building']).toBe('Oak, Court');
    expect(parsed.rows[0]!['Monthly']).toBe('1850');
  });

  it('parses the first worksheet of an Excel workbook', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Property Name', 'Unit Number'], ['Test Lofts', '101']]), 'Units');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parseSpreadsheet(buffer, 'portfolio.xlsx');
    expect(parsed.sheets).toEqual(['Units']);
    expect(parsed.rows[0]!['Property Name']).toBe('Test Lofts');
  });

  it('suggests flexible field mappings and normalizes money and dates', () => {
    const parsed = parseSpreadsheet(Buffer.from('Building,Apt #,Resident,Renter Email,Start Date,Monthly\nTest Lofts,101,Jamie Rivera,jamie@example.com,09/01/26,"$1,850.00"\n'), 'portfolio.csv');
    const suggestion = suggestMapping(parsed.headers);
    expect(suggestion.mapping.propertyName).toBe('Building');
    expect(suggestion.mapping.unitNumber).toBe('Apt #');
    const records = normalizeRows(parsed.rows, { ...suggestion.mapping, propertyName: 'Building', unitNumber: 'Apt #', tenantName: 'Resident', email: 'Renter Email', leaseStart: 'Start Date', monthlyRent: 'Monthly' });
    expect(records[0]!.lease?.monthlyRent).toBe(1850);
    expect(records[0]!.lease?.startDate).toBe('2026-09-01');
    expect(records[0]!.issues).not.toContain('Email is required to safely associate or create an existing tenant account.');
  });

  it('flags invalid dates, rent, email, and unsafe missing account identity', () => {
    const records = normalizeRows([{ Property: 'Test Lofts', Unit: '101', Tenant: 'Jamie Rivera', Email: 'not-an-email', Start: 'not-a-date', Rent: 'unknown' }], { propertyName: 'Property', unitNumber: 'Unit', tenantName: 'Tenant', email: 'Email', leaseStart: 'Start', monthlyRent: 'Rent' });
    expect(records[0]!.issues).toEqual(expect.arrayContaining(['Lease start date is missing or invalid.', 'Monthly rent is missing or invalid.', 'Email address is invalid.']));
    expect(records[0]!.lease).toBeNull();
  });

  it('escapes formula-like values in review reports', () => {
    const records = [{ rowNumber: 2, classification: 'REVIEW' as const, issues: ['=HYPERLINK("http://bad")'], warnings: [], property: null, unit: null, tenant: null, lease: null, matches: [] }];
    const report = errorReportCsv(records);
    expect(report).toContain("'=HYPERLINK");
  });
});
