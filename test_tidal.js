console.log('Testing Tidal SDK...');
try {
  const { TidalAuth } = require('@tidal-music/auth');
  const { TidalApi } = require('@tidal-music/api');
  console.log('✅ SDK imported');
  
  const auth = new TidalAuth({
    clientId: 'pUlCxd80DuDSem4J',
    clientSecret: '',
    credentialsStorageKey: 'test'
  });
  console.log('✅ Auth created');
  
  const api = new TidalApi({ auth });
  console.log('✅ API created');
  
  console.log('🎉 Tidal SDK test successful!');
} catch(e) {
  console.error('❌ Error:', e.message);
  console.error(e.stack);
}
