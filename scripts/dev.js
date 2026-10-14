import { watchFile, unwatchFile } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.resolve(clientDir, '..', 'web-monitor-server');
const envPath = path.join(serverDir, '.env');
const processes = new Map();
let shuttingDown = false;
let restartingBackend = false;
let restartRequested = false;
let restartTimer;

function startProcess(name, cwd, args) {
	const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
	processes.set(name, child);
	child.once('error', (error) => {
		if (processes.get(name) !== child) return;
		console.error(`${name} failed to start:`, error);
		void shutdown(1);
	});
	child.once('exit', (code, signal) => {
		if (shuttingDown || processes.get(name) !== child) return;
		if (restartingBackend && (name === 'API server' || name === 'Monitor worker')) return;
		console.error(`${name} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}. Stopping the other development services.`);
		void shutdown(code || 1);
	});
}

function stopProcess(name) {
	const child = processes.get(name);
	if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		child.once('exit', resolve);
		child.kill('SIGTERM');
	});
}

async function restartBackend() {
	if (shuttingDown) return;
	if (restartingBackend) {
		restartRequested = true;
		return;
	}
	restartingBackend = true;
	console.log('web-monitor-server/.env changed; restarting API and worker to reload local settings.');
	try {
		await Promise.all([stopProcess('API server'), stopProcess('Monitor worker')]);
		if (shuttingDown) return;
		startProcess('API server', serverDir, [path.join(serverDir, 'src', 'index.js')]);
		startProcess('Monitor worker', serverDir, [path.join(serverDir, 'src', 'worker.js')]);
	} catch (error) {
		console.error('Unable to restart API and worker after the environment file changed:', error);
		void shutdown(1);
	} finally {
		restartingBackend = false;
		if (restartRequested && !shuttingDown) {
			restartRequested = false;
			clearTimeout(restartTimer);
			restartTimer = setTimeout(() => { void restartBackend(); }, 500);
		}
	}
}

async function shutdown(exitCode) {
	if (shuttingDown) return;
	shuttingDown = true;
	clearTimeout(restartTimer);
	unwatchFile(envPath);
	process.exitCode = exitCode;
	await Promise.all([...processes.keys()].map(stopProcess));
}

process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });

console.log('Starting Vite, API server, and website monitor worker...');
startProcess('Vite', clientDir, [path.join(clientDir, 'node_modules', 'vite', 'bin', 'vite.js')]);
startProcess('API server', serverDir, [path.join(serverDir, 'src', 'index.js')]);
startProcess('Monitor worker', serverDir, [path.join(serverDir, 'src', 'worker.js')]);
watchFile(envPath, { interval: 500 }, (current, previous) => {
	if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
	clearTimeout(restartTimer);
	restartTimer = setTimeout(() => { void restartBackend(); }, 500);
});