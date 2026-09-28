// NOT CURRENTLY WIRED INTO server.js.
// This is the encryption layer for WhatsApp Flows (native multi-screen
// forms), built and tested end-to-end. Sending/publishing a Flow requires
// Meta Business Verification on the WABA, which Oven Art hasn't passed yet
// (see health_status errors 141010/141006). Once verification clears, see
// flow/flow.json + flowEndpoint.js and re-add the /flow-data route in
// server.js (removed for now to keep the live bot on the free Lists/Buttons
// UX in orderFlow.js).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY_PATH = path.join(__dirname, "..", "keys", "flow_private.pem");
const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

/**
 * Decrypt an incoming WhatsApp Flows data-exchange request body.
 * @returns {{ decryptedBody: object, aesKeyBuffer: Buffer, initialVectorBuffer: Buffer }}
 */
function decryptRequest(body) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;

  const aesKeyBuffer = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privateKeyPem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");

  const TAG_LENGTH = 16;
  const encryptedBody = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const authTag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKeyBuffer, initialVectorBuffer);
  decipher.setAuthTag(authTag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encryptedBody),
    decipher.final(),
  ]).toString("utf-8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer,
    initialVectorBuffer,
  };
}

/**
 * Encrypt a response payload to send back to WhatsApp Flows.
 * Uses the same AES key with a bit-flipped IV, per Meta's spec.
 */
function encryptResponse(responseObj, aesKeyBuffer, initialVectorBuffer) {
  const flippedIv = Buffer.from(initialVectorBuffer.map((byte) => ~byte & 0xff));

  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);

  return Buffer.concat([
    cipher.update(JSON.stringify(responseObj), "utf-8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}

module.exports = { decryptRequest, encryptResponse };
