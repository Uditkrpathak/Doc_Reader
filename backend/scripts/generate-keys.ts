import * as jose from 'jose';

async function main() {
  console.log('Generating Ed25519 Key Pair for Offline Entitlement Tokens...\n');

  const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });

  const privateKeyPem = await jose.exportPKCS8(privateKey);
  const publicKeyPem = await jose.exportSPKI(publicKey);

  console.log('=== OFFLINE_TOKEN_PRIVATE_KEY ===');
  console.log(privateKeyPem);
  console.log('=== OFFLINE_TOKEN_PUBLIC_KEY ===');
  console.log(publicKeyPem);
  console.log('=================================');
  console.log('\nCopy these values into your .env or secret manager.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

