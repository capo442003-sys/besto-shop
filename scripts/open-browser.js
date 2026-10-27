import { exec } from 'child_process';

const url = process.env.BMB_URL || 'http://localhost:3001';

const cmd = process.platform === 'win32'
  ? `start "" "${url}"`
  : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;

exec(cmd, (err) => {
  if (err) console.error('Ouvrez manuellement :', url);
  else console.log('Navigateur ouvert :', url);
});
