import {
	exec
} from './shell'
import shortid from 'shortid'
import * as sander from 'sander'
import _ from 'lodash'
import db from './db'
import {
	getInstance as getIOInstance
} from './sockets'
const console = require('tracer').colorConsole();
var errToJSON = require('error-to-json')

const LOCAL_WORKER_CWD = process.env.LOCAL_WORKER_CWD //"/Users/javier/git/wrapkend-shared-worker"
const SHARED_WORKER_REPO = process.env.SHARED_WORKER_REPO|| "git@github.com:javimosch/wrapkend-shared-worker.git"

var state = {
	shared: {},
	events: {}
}

export async function execute(actionDoc, data) {
	return executeOnSharedEnviroment(actionDoc, data)
}

export function executeOnSharedEnviroment(actionDoc, data) {
	return new Promise((resolve, reject) => {


		(async function executeOnSharedEnviromentAsync() {
			console.log('exec', actionDoc.name, 'Configuring block...')
			await configureBlock(actionDoc)
			let block = state.shared[actionDoc.project]
			let id = shortid.generate();

			if (!actionDoc.compiledCode) {
				throw new Error('ACTION_COMPILED_CODE_MISSING')
			}



			state.events[`then-${id}`] = d => finish(null, d)
			state.events[`catch-${id}`] = err => finish(err)

			console.log('exec', actionDoc.name, 'Sending order...', state.events)

			var emit = () => block.nsp.emit('exec', {
				id,
				n: actionDoc.name,
				c: actionDoc.compiledCode,
				d: data
			});
			emit();

			block.nsp.once('connect', () => {
				emit();
			})

			var resolved = false;
			setTimeout(() => {
				if (!resolved) {
					delete state.events[`then-${id}`]
					delete state.events[`catch-${id}`]
					finish(new Error('WORKER_EMIT_TIMEOUT'))
				}
			}, 10000)

			function finish(err, data) {
				resolved = true
				console.log('EXEC FINISH', actionDoc.name, !!err ? 'SUCCESS' : 'ERROR')
				if (err) {
					reject(err)
				} else resolve(data)
			}

		})().catch(reject)


	});
}

async function waitForWorkerSocket(block, timeout) {
	return new Promise((resolve, reject) => {
		let start = Date.now;
		let resolved = false;
		let err = new Error('WORKER_TIMEOUT')

		function verify() {
			if (!block.socket) return setTimeout(verify, 100)
			let hash = shortid.generate()

			block.socket.once('pongi', d => {
				if (Date.now() - start > timeout && !resolved) {
					resolved = true
					return reject(err)
				}
				if (d.hash == hash) {
					resolved = true;
					resolve(true)
				}
			});
			block.nsp.emit('pingi', {
				hash
			})
		}
		setTimeout(() => {
			if (!resolved) {
				resolved = true
				reject(err)
			}
		}, timeout)
		verify();
	})

}

async function configureSockets(actionDoc, block) {
	const io = getIOInstance()
	var nsp = io.of(actionDoc.project.appName);
	nsp.on('connect', function(socket) {
		socket.on('then', data => {

			let id = data.$id;
			let name = data.$n;
			console.log('SOCKET THEN', id, name)
			delete data.$id;
			delete data.$n
			if (state.events && state.events['then-' + id]) {
				console.log('SOCKET THEN', id, 'CALLNG')
				state.events['then-' + id](data.result)
				delete state.events['then-' + id]
			} else {
				//console.error('Listener missing for ', name, 'THEN', data.result, state.events)
			}
		})
		socket.on('catch', data => {

			let id = data.$id;
			let name = data.$n;
			console.log('SOCKET CATCH', id, name, data.err && data.err.message)
			delete data.$id;
			delete data.$n
			if (state.events && state.events['catch-' + id]) {
				console.log('SOCKET CATCH', id, 'CALLING')
				state.events['catch-' + id](data.err)
				delete state.events['catch-' + id]
			} else {
				//console.error('Listener missing for ', name, 'CATCH', data.err)
			}
		})
	});
	block.nsp = nsp;
}

async function configureBlock(actionDoc) {
	let block = state.shared[actionDoc.project] || {
		new: true
	}

	actionDoc = await actionDoc.populate({
		path: 'project',
		select: 'appName dependencies'
	}).execPopulate()

	if (!actionDoc.project.appName) throw new Error('PROJECT_APP_NAME_NOT_FOUND')
	if (!actionDoc.project.dependencies) throw new Error('PROJECT_DEPENDENCIES_ARE_MISSING')
	if (actionDoc.project.dependencies.length === 0) throw new Error('PROJECT_DEPENDENCIES_ARE_EMPTY')

	if (block.new || block.child && block.child.killed) {
		var cwd;
		if (LOCAL_WORKER_CWD) {
			block.cwd = cwd = LOCAL_WORKER_CWD
		} else {
			cwd = `/tmp/${actionDoc.project.appName}`
			await sander.rimraf(`${cwd}/**`)
			await exec(`git clone ${SHARED_WORKER_REPO} ${cwd}`)
			block.cwd = cwd;
		}
		var a = actionDoc.project.dependencies;
		let dependencies = _.mapValues(_.keyBy(a, (x) => x.split('@')[0]), (x) => x.split('@').length > 1 ? x.split('@')[1] : '');
		let packageFileContent = JSON.stringify({
			dependencies: dependencies
		}, null, 2)
		let pak = JSON.parse(await sander.readFile(`${cwd}/package.json`))
		pak.dependencies = Object.assign(dependencies, pak.dependencies);
		await sander.writeFile(`${cwd}/package.json`, JSON.stringify(pak, null, 2))
		await exec(`cd ${block.cwd}; yarn;`)
		exec(`node ${block.cwd}/worker-node.js --prefix ${block.cwd}`, {
			getChild: c => block.child = c,
			cwd: block.cwd
		});
		await configureSockets(actionDoc, block);
		block.updatedAt = Date.now()
		delete block.new
	} else {

		//update dependencies if needed

	}
	state.shared[actionDoc.project] = block;
}

function getSharedWorkerCWD(appName) {
	var cwd
	if (LOCAL_WORKER_CWD) {
		return LOCAL_WORKER_CWD
	} else {
		return `/tmp/${appName}`
		return cwd;
	}
}

export async function updateSharedWorkerDependencies(project) {
	let doc = db.conn().model('wra_project').findById(project).select('appName dependencies').exec();
	let block = state.shared[project] || {
		new: true
	}
	if(block.new){
		block.cwd = getSharedWorkerCWD(project.appName)
		await sander.rimraf(`${block.cwd}/**`)
		await exec(`git clone ${SHARED_WORKER_REPO} ${block.cwd}`)
	}
	if (block.child && !block.child.killed) {
		block.child.kill()
		block.new = true;
	}
	var a = project.dependencies;
	let dependencies = _.mapValues(_.keyBy(a, (x) => x.split('@')[0]), (x) => x.split('@').length > 1 ? x.split('@')[1] : '');
	let packageFileContent = JSON.stringify({
		dependencies: dependencies
	}, null, 2)
	let pak = JSON.parse(await sander.readFile(`${block.cwd}/package.json`))
	pak.dependencies = Object.assign(dependencies, pak.dependencies);
	await sander.writeFile(`${block.cwd}/package.json`, JSON.stringify(pak, null, 2))
	await exec(`cd ${block.cwd}; yarn;`)
	return true;
}