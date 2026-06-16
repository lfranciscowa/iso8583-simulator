// ============================================================================
//  KEY VAULT — cifrado en reposo de las llaves 3DES del llavero.
//
//  Las llaves del llavero (config/keys.json) se guardan cifradas con AES-256-GCM
//  bajo una Key Encryption Key (KEK) derivada de SIM_MASTER_KEY (variable de
//  entorno). Si no se define SIM_MASTER_KEY, se usa una KEK fija de laboratorio
//  (NO usar en producción: cualquiera con el código puede derivarla).
// ============================================================================

'use strict';

const crypto = require('crypto');

const LAB_DEFAULT_SECRET = 'iso8583-lab-default-secret-do-not-use-in-prod';

function getKek() {
  const secret = process.env.SIM_MASTER_KEY || LAB_DEFAULT_SECRET;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

// Cifra un string (la llave 3DES en hex) → payload serializado para JSON.
function seal(plainText) {
  const kek = getKek();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('hex'),
  };
}

// Descifra un payload generado por seal() → string original.
function unseal(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload cifrado inválido');
  const kek = getKek();
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const data = Buffer.from(payload.data, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function usingDefaultSecret() {
  return !process.env.SIM_MASTER_KEY;
}

module.exports = { seal, unseal, usingDefaultSecret };
