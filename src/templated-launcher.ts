import { Server } from 'http';
// @ts-ignore
import { Bridge } from './now__bridge.js';
// @ts-ignore
const page = require(__LAUNCHER_PAGE_PATH__);

// page.render is for React rendering
// page.default is for /api rendering
// page is for module.exports in /api
const server = new Server(page.render || page.default || page);
const bridge = new Bridge(server);
bridge.listen();

exports.launcher = bridge.launcher;
