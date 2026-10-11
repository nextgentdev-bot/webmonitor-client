import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.resolve(clientDir, '..', 'web-monitor-server');
const processes = new Map();
let shuttingDown = false;

function startProcess(name, cwd, args) {
	const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
	processes.set(name, child);
	child.once('error', (error) => {
		console.error(`${name} failed to start:`, error);
		void shutdown(1);
	});
	child.once('exit', (code, signal) => {
		if (shuttingDown) return;
		console.error(`${name} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}. Stopping the other development services.`);
		void shutdown(code || 1);
	});
}

async function shutdown(exitCode) {
	if (shuttingDown) return;
	shuttingDown = true;
	process.exitCode = exitCode;
	const running = [...processes.values()].filter((child) => child.exitCode === null && child.signalCode === null);
	for (const child of running) child.kill('SIGTERM');
	await Promise.all(running.map((child) => new Promise((resolve) => child.once('exit', resolve))));
}

process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

console.log('Starting Vite, API server, and website monitor worker...');
startProcess('Vite', clientDir, [path.join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js')]);
startProcess('API server', serverDir, [path.join(serverDir, 'src', 'index.js')]);
startProcess('Monitor worker', serverDir, [path.join(serverDir, 'src', 'worker.js')]);
