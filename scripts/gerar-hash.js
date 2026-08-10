const bcrypt = require('bcryptjs');

const senha = process.argv[2];

if (!senha) {
  console.log('Uso: node scripts/gerar-hash.js "suaSenha"');
  process.exit(1);
}

const hash = bcrypt.hashSync(senha, 10);
console.log('\nHash gerado (copie o valor abaixo para USER1_PASS_HASH ou USER2_PASS_HASH):\n');
console.log(hash);
console.log('');
