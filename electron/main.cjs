/**
 * Point d'entrée de secours : Railpack détectait parfois Electron.
 * En cloud, on démarre le backend qui sert le frontend.
 */
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const child = spawn("npm", ["run", "start:cloud", "--prefix", "backend"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
