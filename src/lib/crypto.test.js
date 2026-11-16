import test from 'node:test'
import assert from 'node:assert/strict'
import { UnsupportedFileError, WrongPasswordError, decryptText, encryptText } from './crypto.js'

test('settings encrypted with a password come back with the same password only', async () => {
  const text = JSON.stringify({ boards: [{ title: '看板', sheetId: 'abc' }] })
  const file = await encryptText(text, 'correct horse')
  assert.equal(file.data.includes('sheetId'), false)
  assert.equal(await decryptText(file, 'correct horse'), text)
  await assert.rejects(decryptText(file, 'wrong horse'), WrongPasswordError)
})

test('a file asking for an unknown method or absurd work is refused', async () => {
  const file = await encryptText('{}', 'correct horse')
  await assert.rejects(decryptText({ ...file, encryption: { ...file.encryption, cipher: 'ROT13' } }, 'x'), UnsupportedFileError)
  await assert.rejects(decryptText({ ...file, encryption: { ...file.encryption, iterations: 1e12 } }, 'x'), UnsupportedFileError)
})
