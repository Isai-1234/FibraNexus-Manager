/**
 * Validación RUT chileno — contratos unitarios.
 * Ejecutar: node --test server/src/lib/__tests__/rut.unit.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRut,
  normalizeRut,
  isValidRut,
  assertOptionalRut,
  computeRutDv,
} from '../rut.js';

describe('RUT chileno', () => {
  it('normaliza con y sin guión/puntos', () => {
    assert.equal(normalizeRut('12.345.678-5'), '12345678-5');
    assert.equal(normalizeRut('123456785'), '12345678-5');
    assert.equal(normalizeRut('12345678-5'), '12345678-5');
  });

  it('valida dígito verificador', () => {
    assert.equal(computeRutDv('12345678'), '5');
    assert.equal(isValidRut('12345678-5'), true);
    assert.equal(isValidRut('12345678-9'), false);
    assert.equal(isValidRut('11.111.111-1'), true);
  });

  it('assertOptionalRut acepta vacío y rechaza inválido', () => {
    assert.equal(assertOptionalRut(null), null);
    assert.equal(assertOptionalRut(''), null);
    assert.equal(assertOptionalRut('12345678-5'), '12345678-5');
    assert.throws(() => assertOptionalRut('12345678-0'), /RUT inválido/);
  });

  it('cleanRut quita puntos y espacios', () => {
    assert.equal(cleanRut(' 12.345.678-k '), '12345678-K');
  });
});
