const pngToIco = require('png-to-ico');
const fs = require('fs');

// png-to-ico peut exporter via .default selon la version
const convert = pngToIco.default || pngToIco;

convert(['icon.png'])
  .then(buf => {
    fs.writeFileSync('icon.ico', buf);
    console.log('icon.ico créé avec succès !');
  })
  .catch(err => console.error('Erreur :', err));

