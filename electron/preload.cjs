const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('bmbDesktop', {
  isDesktop: true,
  platform: process.platform,
});
